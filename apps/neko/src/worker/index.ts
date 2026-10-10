import { type Cents, historyDelta, MAX_INSTALLMENTS, todayIn } from "@neko/engine";
import { SheetStructureError } from "@neko/sheet-reader";
import * as Sentry from "@sentry/cloudflare";
import { Hono, type MiddlewareHandler } from "hono";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import { ajustesView, invoicesView, monthsView, simulateView } from "../shared/screens.ts";
import { todayView } from "../shared/today.ts";
import type { BanksResponse, MiaStatus } from "../shared/types.ts";
import { assetLinks } from "./android.ts";
import {
  endSession,
  pruneSessions,
  requireSession,
  sessionEmail,
  startSession,
  verifyGoogleCredential,
} from "./auth.ts";
import { entries, queue } from "./entries.ts";
import type { AppEnv, Env } from "./env.ts";
import {
  askMia,
  CAP_MICRO_USD,
  fillEntry,
  MiaEntryRequest,
  MiaRequest,
  MiaSpendLimit,
  recordUsage,
  spentThisMonth,
} from "./mia.ts";
import {
  authenticationOptions,
  registrationOptions,
  usableInvite,
  verifyAuthentication,
  verifyRegistration,
} from "./passkey.ts";
import { backfillEdits, getProjection, monthEndHistory, pruneSnapshots } from "./pipeline.ts";
import {
  configured,
  ensureWebhook,
  HOOK_HEADER,
  itemIds,
  pluggy,
  refreshAll,
  sameSecret,
  syncAll,
  syncItem,
  WebhookEvent,
} from "./pluggy.ts";
import {
  eveningMessage,
  morningMessage,
  readFailedMessage,
  remindersView,
  sendReminder,
} from "./push.ts";
import { keepBankCards, loadSettings, saveSettings, UserSettings } from "./settings.ts";

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
app.use("/today", requireSession);
app.use("/invoices", requireSession);
app.use("/months", requireSession);
app.use("/ajustes", requireSession);
app.use("/reminders", requireSession);
app.use("/history", requireSession);
app.use("/simulate", requireSession);
app.use("/settings", requireSession);
app.use("/push/*", requireSession);
app.use("/sessions", requireSession);
app.use("/sessions/*", requireSession);
app.use("/client-error", requireSession);
app.use("/banks", requireSession);
app.use("/banks/*", requireSession);
app.use("/mia", requireSession);
app.use("/mia/*", requireSession);
app.use("/entries", requireSession);
app.use("/entries/*", requireSession);
app.use("/queue/*", requireSession);
app.route("/entries", entries);
app.route("/queue", queue);

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

/**
 * Pluggy calls this when a linked bank has news. The body only names the item; the data is read
 * from Pluggy's API, after answering, so the 10-second deadline never matters.
 */
app.post("/pluggy/webhook", async (c) => {
  const secret = c.env.PLUGGY_WEBHOOK_SECRET ?? "";
  if (!sameSecret(c.req.header(HOOK_HEADER) ?? "", secret))
    return c.json({ error: "forbidden" }, 403);
  const event = WebhookEvent.safeParse(await c.req.json().catch(() => null));
  // One refresh sends many events (transactions/created, /updated…); "item/updated" says it is
  // done, so the bank is read once. The 06:00 cron catches anything a lost webhook left behind.
  const itemId =
    event.success && event.data.event === "item/updated" ? event.data.itemId : undefined;
  if (itemId && configured(c.env) && (await itemIds(c.env.DB)).includes(itemId))
    c.executionCtx.waitUntil(
      syncItem(c.env.DB, pluggy(c.env, fetch), itemId, todayIn(new Date())).catch((error) =>
        console.error("bank sync failed", itemId, error),
      ),
    );
  return c.json({ ok: true });
});

const BankItems = z.object({
  items: z
    .array(
      z.object({
        itemId: z.string().trim().uuid(),
        label: z.string().trim().min(1).max(40),
      }),
    )
    .max(5),
});

interface BankRow {
  item_id: string;
  label: string;
  synced_at: string | null;
  error: string | null;
}

/** The linked banks, when each was last read, and the accounts and cards found in each. */
app.get("/banks", async (c) => {
  const items = (
    await c.env.DB.prepare(
      "SELECT item_id, label, synced_at, error FROM bank_item ORDER BY label",
    ).all<BankRow>()
  ).results;
  const accounts = (
    await c.env.DB.prepare(
      "SELECT id, item_id, name, type, number, balance FROM bank_account ORDER BY name",
    ).all<{
      id: string;
      item_id: string;
      name: string;
      type: string;
      number: string | null;
      balance: number;
    }>()
  ).results;
  // The physical cards seen on each card account: the holder's and any additional one.
  const numbers = (
    await c.env.DB.prepare(
      "SELECT DISTINCT account_id, card_number FROM bank_txn WHERE card_number IS NOT NULL",
    ).all<{ account_id: string; card_number: string }>()
  ).results;
  const last4 = (s: string) => s.replace(/\D/g, "").slice(-4);
  const settings = await loadSettings(c.env.DB);
  const body: BanksResponse = {
    configured: configured(c.env),
    cards: settings.bankCards,
    items: items.map((i) => ({
      itemId: i.item_id,
      label: i.label,
      syncedAt: i.synced_at,
      error: i.error,
      accounts: accounts
        .filter((a) => a.item_id === i.item_id)
        .map((a) => ({
          id: a.id,
          name: a.name,
          card: a.type === "CREDIT",
          last4: a.number?.slice(-4) ?? null,
          balance: a.balance as Cents,
          cardNumbers: [
            ...new Set(
              numbers
                .filter((n) => n.account_id === a.id)
                .map((n) => last4(n.card_number))
                .filter((n) => n.length === 4),
            ),
          ].sort(),
          use: a.type === "CREDIT" ? null : (settings.accountUse[a.id] ?? null),
        })),
    })),
  };
  return c.json(body);
});

/** Ties each bank card to its name in the sheet, so its bills can be checked against it. */
app.put("/banks/cards", async (c) => {
  const { cards } = z
    .object({ cards: UserSettings.shape.bankCards.unwrap() })
    .parse(await c.req.json());
  const settings = await loadSettings(c.env.DB);
  await saveSettings(c.env.DB, { ...settings, bankCards: cards });
  return c.json({ ok: true });
});

/** Replaces the list of linked banks, drops what was read from removed ones and reads the rest. */
app.put("/banks", async (c) => {
  const { items } = BankItems.parse(await c.req.json());
  const keep = JSON.stringify(items.map((i) => i.itemId));
  const db = c.env.DB;
  await db.batch([
    db
      .prepare(
        "DELETE FROM bank_txn WHERE account_id IN (SELECT id FROM bank_account WHERE item_id NOT IN (SELECT value FROM json_each(?)))",
      )
      .bind(keep),
    db
      .prepare(
        "DELETE FROM bank_bill WHERE account_id IN (SELECT id FROM bank_account WHERE item_id NOT IN (SELECT value FROM json_each(?)))",
      )
      .bind(keep),
    db
      .prepare("DELETE FROM bank_account WHERE item_id NOT IN (SELECT value FROM json_each(?))")
      .bind(keep),
    db
      .prepare("DELETE FROM bank_item WHERE item_id NOT IN (SELECT value FROM json_each(?))")
      .bind(keep),
    ...items.map((i) =>
      db
        .prepare(
          "INSERT INTO bank_item (item_id, label) VALUES (?, ?) ON CONFLICT(item_id) DO UPDATE SET label = excluded.label",
        )
        .bind(i.itemId, i.label),
    ),
  ]);
  if (configured(c.env)) c.executionCtx.waitUntil(bankSync(c.env));
  return c.json({ ok: true });
});

/** Atualizar agora, from Para lançar: the banks are read now instead of at the next cron. */
app.post("/banks/refresh", async (c) => {
  if (!configured(c.env)) return c.json({ ok: false });
  const failed = await refreshAll(c.env.DB, pluggy(c.env, fetch), todayIn(new Date()));
  return c.json({ ok: failed === 0 });
});

/** Reads every linked bank and makes sure Pluggy knows where to send news. */
const bankSync = async (env: Env) => {
  if (!configured(env)) return;
  const api = pluggy(env, fetch);
  try {
    if (env.SITE_URL && env.PLUGGY_WEBHOOK_SECRET)
      await ensureWebhook(api, `${env.SITE_URL}/api/pluggy/webhook`, env.PLUGGY_WEBHOOK_SECRET);
  } catch (error) {
    console.error("pluggy webhook setup failed", error);
  }
  const failed = await syncAll(env.DB, api, todayIn(new Date()));
  if (failed > 0) Sentry.captureMessage(`bank sync: ${failed} bank(s) failed`);
};

/** First day of the next month, when a paused Mia comes back. */
const nextMonthStart = (today: string) => {
  const [y = 0, m = 1] = today.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
};

/** Whether Mia is on, and how much of the month's cap is spent (specs/004-mia). */
app.get("/mia", async (c) => {
  const today = todayIn(new Date());
  if (!c.env.ANTHROPIC_API_KEY) return c.json(miaStatus(false, 0, today));
  return c.json(miaStatus(true, await spentThisMonth(c.env.DB, today), today));
});

const miaStatus = (on: boolean, spent: number, today: string): MiaStatus => ({
  ligada: on,
  usadoPct: Math.min(100, Math.floor((spent / CAP_MICRO_USD) * 100)),
  pausadaAte: spent >= CAP_MICRO_USD ? nextMonthStart(today) : null,
});

app.post("/mia", async (c) => {
  const key = c.env.ANTHROPIC_API_KEY;
  if (!key) throw new HTTPException(404);
  const parsed = MiaRequest.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new HTTPException(400);
  const now = new Date();
  const today = todayIn(now);
  const spent = await spentThisMonth(c.env.DB, today);
  const paused = () => c.json({ pausadaAte: nextMonthStart(today) }, 429);
  if (spent >= CAP_MICRO_USD) return paused();
  const { projection } = await getProjection(c.env, today);
  try {
    const deps = { fetch, key, spentMicroUsd: spent, record: recordUsage(c.env.DB, today, now) };
    return c.json(await askMia(deps, projection, today, parsed.data));
  } catch (e) {
    if (e instanceof MiaSpendLimit) return paused();
    throw e;
  }
});

/** Lançar com a Mia: a sentence fills the Lançar form; nothing is written here. */
app.post("/mia/lancamento", async (c) => {
  const key = c.env.ANTHROPIC_API_KEY;
  if (!key) throw new HTTPException(404);
  const parsed = MiaEntryRequest.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new HTTPException(400);
  const now = new Date();
  const today = todayIn(now);
  const spent = await spentThisMonth(c.env.DB, today);
  const paused = () => c.json({ pausadaAte: nextMonthStart(today) }, 429);
  if (spent >= CAP_MICRO_USD) return paused();
  try {
    const deps = { fetch, key, spentMicroUsd: spent, record: recordUsage(c.env.DB, today, now) };
    return c.json({ lancamento: await fillEntry(deps, today, parsed.data) });
  } catch (e) {
    if (e instanceof MiaSpendLimit) return paused();
    throw e;
  }
});

app.get("/projection", async (c) => c.json(await getProjection(c.env, todayIn(new Date()))));

/** Hoje already grouped and filtered, for the Android app and its widget. */
app.get("/today", async (c) => {
  const [data, settings] = await Promise.all([
    getProjection(c.env, todayIn(new Date())),
    loadSettings(c.env.DB),
  ]);
  return c.json(todayView(data, settings.reviewed));
});

/** Faturas, Mês and Ajustes ready to draw, for the Android app (see shared/screens.ts). */
app.get("/invoices", async (c) =>
  c.json(invoicesView(await getProjection(c.env, todayIn(new Date())))),
);

app.get("/months", async (c) =>
  c.json(monthsView(await getProjection(c.env, todayIn(new Date())))),
);

app.get("/ajustes", async (c) => {
  const [data, settings] = await Promise.all([
    getProjection(c.env, todayIn(new Date())),
    loadSettings(c.env.DB),
  ]);
  return c.json(ajustesView(data, settings));
});

const Purchase = z.object({
  amount: z.coerce.number().int().positive().max(100_000_000_00),
  count: z.coerce.number().int().min(1).max(MAX_INSTALLMENTS),
});

/** Hoje's purchase simulator for the Android app: amount in cents, count of parcels. */
app.get("/simulate", async (c) => {
  const { amount, count } = Purchase.parse(c.req.query());
  const data = await getProjection(c.env, todayIn(new Date()));
  return c.json(simulateView(data, amount as Cents, count));
});

/** Today's 08:00 and 21:00 reminders, for the Android app to show itself (see push.ts). */
app.get("/reminders", async (c) =>
  c.json(remindersView(await getProjection(c.env, todayIn(new Date())))),
);

app.get("/history", async (c) => {
  const points = await monthEndHistory(c.env.DB, todayIn(new Date()));
  return c.json({ points, delta: historyDelta(points) });
});

app.get("/settings", async (c) => c.json(await loadSettings(c.env.DB)));

app.put("/settings", async (c) => {
  const settings = keepBankCards(await c.req.json(), await loadSettings(c.env.DB));
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
const BANKS = "0 9 * * *"; // 06:00, after Meu Pluggy's daily refresh and before "hoje cabem"

/** Errors go to Sentry when SENTRY_DSN is set; without it the SDK stays off. */
const sentry = (env: Env) => ({
  dsn: env.SENTRY_DSN || undefined,
  tracesSampleRate: 0,
});

/** The API plus the one file Android reads from the site's root. */
const site = new Hono<AppEnv>();
site.get("/.well-known/assetlinks.json", (c) => {
  c.header("Cache-Control", "public, max-age=3600");
  return c.json(assetLinks(c.env));
});
site.route("/", app);

export default Sentry.withSentry(sentry, {
  fetch: site.fetch,
  /**
   * 08:00 in São Paulo: refresh the projection, record the day's point in the forecast history
   * and send "hoje cabem". 21:00: remind to log the day in the sheet, unless it already is.
   */
  async scheduled(event, env, ctx) {
    if (event.cron === BANKS) {
      // A safety net for webhooks Pluggy gave up on (it tries three times).
      ctx.waitUntil(bankSync(env).catch((error) => Sentry.captureException(error)));
      return;
    }
    const run = async () => {
      // Housekeeping does not depend on the sheet: a failed read must not let the cache grow.
      if (event.cron === MORNING)
        await Promise.all([pruneSnapshots(env.DB), pruneSessions(env.DB)]).catch((error) =>
          console.error("pruning failed", error),
        );
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
        await backfillEdits(env).catch((error) => console.error("revision backfill failed", error));
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
