import { historyDelta, todayIn } from "@neko/engine";
import { SheetStructureError } from "@neko/sheet-reader";
import * as Sentry from "@sentry/cloudflare";
import { Hono, type MiddlewareHandler } from "hono";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import {
  endSession,
  pruneSessions,
  requireSession,
  sessionEmail,
  startSession,
  verifyGoogleCredential,
} from "./auth.ts";
import type { AppEnv, Env } from "./env.ts";
import {
  authenticationOptions,
  registrationOptions,
  usableInvite,
  verifyAuthentication,
  verifyRegistration,
} from "./passkey.ts";
import { getProjection, monthEndHistory, pruneSnapshots } from "./pipeline.ts";
import { eveningMessage, morningMessage, readFailedMessage, sendReminder } from "./push.ts";
import { loadSettings, saveSettings, UserSettings } from "./settings.ts";

const app = new Hono<AppEnv>().basePath("/api");

// Defense in depth for a personal-finance API: strict headers, a same-origin check on form-like
// posts, and nothing cached by browsers or proxies.
app.use(secureHeaders({ crossOriginResourcePolicy: "same-origin" }), csrf());
app.use(async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  if (err instanceof SheetStructureError)
    return c.json({ error: "sheet-structure", message: err.message }, 422);
  if (err instanceof z.ZodError) return c.json({ error: "invalid", issues: err.issues }, 400);
  Sentry.captureException(err);
  // The details stay in the logs; the client only learns that something failed.
  return c.json({ error: "internal" }, 500);
});

// Sign-in routes answer at most a few times a minute per address. Passkeys and invites cannot be
// guessed, so this only blunts floods and probing; it never locks the owner out for long.
const authLimit: MiddlewareHandler<AppEnv> = async (c, next) => {
  const ip = c.req.header("cf-connecting-ip");
  if (c.env.AUTH_LIMIT && ip && !(await c.env.AUTH_LIMIT.limit({ key: ip })).success)
    return c.json({ error: "rate-limited" }, 429, { "Retry-After": "60" });
  await next();
};
app.use("/auth/*", authLimit);
app.use("/passkey/*", authLimit);

app.get("/config", (c) => c.json({ googleClientId: c.env.GOOGLE_CLIENT_ID || null }));

app.get("/me", async (c) => c.json({ email: await sessionEmail(c) }));

app.post("/auth/google", async (c) => {
  if (!c.env.GOOGLE_CLIENT_ID || !c.env.SESSION_SECRET)
    return c.json({ error: "login-not-configured" }, 503);
  const { credential } = z.object({ credential: z.string().min(1) }).parse(await c.req.json());
  const email = await verifyGoogleCredential(c.env, credential).catch(() => null);
  if (!email) return c.json({ error: "forbidden" }, 403);
  await startSession(c, email);
  return c.json({ email });
});

// Passkeys: a one-time invite creates one; after that the phone signs in on its own.
const Invite = z.object({ invite: z.string().min(20) });
const Credential = z.object({ id: z.string().min(1), type: z.literal("public-key") }).passthrough();

app.post("/passkey/register/options", async (c) => {
  const { invite } = Invite.parse(await c.req.json());
  const email = await usableInvite(c, invite);
  if (!email) return c.json({ error: "invite-invalid" }, 403);
  return c.json(await registrationOptions(c, email));
});

app.post("/passkey/register/verify", async (c) => {
  const body = Invite.extend({ response: Credential }).parse(await c.req.json());
  const email = await verifyRegistration(c, body.invite, body.response as never);
  if (!email) return c.json({ error: "passkey-rejected" }, 403);
  await startSession(c, email);
  return c.json({ email });
});

app.post("/passkey/login/options", async (c) => c.json(await authenticationOptions(c)));

app.post("/passkey/login/verify", async (c) => {
  const { response } = z.object({ response: Credential }).parse(await c.req.json());
  const email = await verifyAuthentication(c, response as never);
  if (!email) return c.json({ error: "passkey-rejected" }, 403);
  await startSession(c, email);
  return c.json({ email });
});

app.post("/auth/logout", async (c) => {
  await endSession(c);
  return c.json({ ok: true });
});

app.use("/projection", requireSession);
app.use("/history", requireSession);
app.use("/settings", requireSession);
app.use("/push/*", requireSession);
app.use("/sessions", requireSession);
app.use("/sessions/*", requireSession);
app.use("/client-error", requireSession);

const ClientError = z.object({
  message: z.string().max(500),
  stack: z.string().max(4000).optional(),
  url: z.string().max(300),
});

/** Errors thrown in the app land in the Worker logs, next to the server's own. */
app.post("/client-error", async (c) => {
  const report = ClientError.parse(await c.req.json());
  console.error(JSON.stringify({ kind: "client-error", ...report }));
  // The app reports through the Worker, so the browser loads no SDK and talks to no third party.
  const error = Object.assign(new Error(report.message), { name: "ClientError" });
  if (report.stack) error.stack = report.stack;
  Sentry.captureException(error, { tags: { source: "web" }, extra: { url: report.url } });
  return c.body(null, 204);
});

interface DeviceRow {
  id_hash: string;
  device: string;
  created_at: string;
  last_seen_at: string;
}

/** Every device signed in to this account, the current one first. */
app.get("/sessions", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id_hash, device, created_at, last_seen_at FROM session WHERE email = ? ORDER BY last_seen_at DESC",
  )
    .bind(c.get("email"))
    .all<DeviceRow>();
  const current = c.get("session");
  return c.json(
    results
      .map((r) => ({
        id: r.id_hash,
        device: r.device,
        createdAt: r.created_at,
        lastSeenAt: r.last_seen_at,
        current: r.id_hash === current,
      }))
      .sort((a, b) => Number(b.current) - Number(a.current)),
  );
});

/** Signs out every other device; this one stays in. */
app.delete("/sessions/others", async (c) => {
  await c.env.DB.prepare("DELETE FROM session WHERE email = ? AND id_hash != ?")
    .bind(c.get("email"), c.get("session"))
    .run();
  return c.json({ ok: true });
});

app.delete("/sessions/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM session WHERE id_hash = ? AND email = ?")
    .bind(c.req.param("id"), c.get("email"))
    .run();
  return c.json({ ok: true });
});

app.get("/projection", async (c) => c.json(await getProjection(c.env, todayIn(new Date()))));

app.get("/history", async (c) => {
  const points = await monthEndHistory(c.env.DB, todayIn(new Date()));
  return c.json({ points, delta: historyDelta(points) });
});

app.get("/settings", async (c) => c.json(await loadSettings(c.env.DB)));

app.put("/settings", async (c) => {
  const settings = UserSettings.parse(await c.req.json());
  await saveSettings(c.env.DB, settings);
  return c.json(settings);
});

app.get("/push/key", (c) => c.json({ publicKey: c.env.VAPID_PUBLIC_KEY || null }));

/** The push services browsers actually use; anything else is not a push endpoint. */
const PUSH_HOSTS =
  /(^|\.)(fcm\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/;

const Subscription = z.object({
  endpoint: z.url({ protocol: /^https$/, hostname: PUSH_HOSTS }),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

app.post("/push/subscription", async (c) => {
  const s = Subscription.parse(await c.req.json());
  await c.env.DB.prepare(
    "INSERT INTO push_subscription (endpoint, p256dh, auth, created_at, session_id_hash) VALUES (?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, session_id_hash = excluded.session_id_hash",
  )
    .bind(s.endpoint, s.keys.p256dh, s.keys.auth, new Date().toISOString(), c.get("session"))
    .run();
  return c.json({ ok: true });
});

app.delete("/push/subscription", async (c) => {
  const { endpoint } = z.object({ endpoint: z.string() }).parse(await c.req.json());
  await c.env.DB.prepare("DELETE FROM push_subscription WHERE endpoint = ?").bind(endpoint).run();
  return c.json({ ok: true });
});

/** Crons run in UTC; São Paulo is UTC−3 all year. */
const MORNING = "0 11 * * *"; // 08:00
const EVENING = "0 0 * * *"; // 21:00

/** Errors go to Sentry when SENTRY_DSN is set; without it the SDK stays off. */
const sentry = (env: Env) => ({
  dsn: env.SENTRY_DSN || undefined,
  tracesSampleRate: 0,
});

export default Sentry.withSentry(sentry, {
  fetch: app.fetch,
  /**
   * 08:00 in São Paulo: refresh the projection, record the day's point in the forecast history
   * and send "hoje cabem". 21:00: remind to log the day in the sheet, unless it already is.
   */
  async scheduled(event, env, ctx) {
    const run = async () => {
      let data: Awaited<ReturnType<typeof getProjection>>;
      try {
        data = await getProjection(env, todayIn(new Date()));
      } catch (error) {
        console.error("scheduled sheet read failed", error);
        Sentry.captureException(error);
        await sendReminder(env, readFailedMessage(error));
        return;
      }
      if (event.cron === MORNING) {
        await Promise.all([pruneSnapshots(env.DB), pruneSessions(env.DB)]);
        const morning = morningMessage(data);
        if (morning) await sendReminder(env, morning);
      } else if (event.cron === EVENING) {
        const evening = eveningMessage(data);
        if (evening) await sendReminder(env, evening);
      }
    };
    ctx.waitUntil(run());
  },
} satisfies ExportedHandler<Env>);
