import {
  type Cents,
  type Change,
  cents,
  clockIn,
  historyDelta,
  localDate,
  MAX_INSTALLMENTS,
  normalizeName,
  type Pace,
  todayIn,
} from "@neko/engine";
import { SheetStructureError } from "@neko/sheet-reader";
import * as Sentry from "@sentry/cloudflare";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import {
  ajustesView,
  invoicesView,
  monthsView,
  scenarioView,
  scenarioViews,
  simulateView,
} from "../shared/screens.ts";
import { todayView } from "../shared/today.ts";
import type { BanksResponse, Mia2Line, MiaStatus } from "../shared/types.ts";
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
import { receiveEmail } from "./inbox.ts";
import { beginSignIn, refreshBanks, signInReminder } from "./meupluggy.ts";
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
  checkCeiling,
  clearNotices,
  EVENING_HOURS,
  eveningJob,
  loadEveningHour,
  pruneNotices,
  raiseNotice,
  recentNotices,
  remindersView,
  saveEveningHour,
} from "./notices.ts";
import {
  authenticationOptions,
  registrationOptions,
  usableInvite,
  verifyAuthentication,
  verifyRegistration,
} from "./passkey.ts";
import {
  BankNotice,
  PhonePurchase,
  prunePhonePurchases,
  saveBankNotice,
  savePhonePurchase,
} from "./phone.ts";
import { backfillEdits, getProjection, monthEndHistory, pruneSnapshots } from "./pipeline.ts";
import {
  configured,
  ensureWebhook,
  HOOK_HEADER,
  hookSync,
  pluggy,
  sameSecret,
  syncAll,
  WebhookEvent,
} from "./pluggy.ts";
import { eveningMessage, morningMessage, readFailedMessage, sendReminder } from "./push.ts";
import { ScenarioBody } from "./scenario.ts";
import { keepBankCards, loadSettings, saveSettings, UserSettings } from "./settings.ts";
import { takeStatement } from "./statement.ts";
import { recordUse, UsagePost, usageSummary } from "./usage.ts";

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
app.use("/reminders/*", requireSession);
app.use("/notices", requireSession);
app.use("/history", requireSession);
app.use("/simulate", requireSession);
app.use("/scenario", requireSession);
app.use("/scenarios", requireSession);
app.use("/settings", requireSession);
app.use("/push/*", requireSession);
app.use("/sessions", requireSession);
app.use("/sessions/*", requireSession);
app.use("/client-error", requireSession);
app.use("/banks", requireSession);
app.use("/banks/*", requireSession);
app.use("/mia", requireSession);
app.use("/mia/*", requireSession);
app.use("/mia2", requireSession);
app.use("/mia2/*", requireSession);
app.use("/entries", requireSession);
app.use("/entries/*", requireSession);
app.use("/queue/*", requireSession);
app.use("/usage", requireSession);
app.use("/purchases", requireSession);
app.use("/purchases/*", requireSession);
app.use("/statement", requireSession);
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
  // Pluggy only needs to hear that the event arrived; the database is touched after answering,
  // so a D1 hiccup is retried in the background instead of failing the request.
  if (itemId && configured(c.env))
    c.executionCtx.waitUntil(
      hookSync(c.env.DB, pluggy(c.env, fetch), itemId, todayIn(new Date())).then(
        () => ceilingAfterRead(c.env),
        (error) => {
          console.error("bank sync failed", itemId, error);
          Sentry.captureException(error);
        },
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

/** Marks a subscription to cancel, or takes the mark off: the method's tag to cancel them all at once. */
app.put("/banks/cancel", async (c) => {
  const { key, on } = z
    .object({ key: z.string().min(1).max(120), on: z.boolean() })
    .parse(await c.req.json());
  const settings = await loadSettings(c.env.DB);
  const rest = settings.cancel.filter((k) => k !== key);
  await saveSettings(c.env.DB, { ...settings, cancel: on ? [...rest, key].slice(-100) : rest });
  return c.json({ ok: true });
});

/** Marks a purchase on your card as someone else's, or as yours again (person null). */
app.put("/banks/owner", async (c) => {
  const { key, person } = z
    .object({
      key: z.string().min(1).max(160),
      person: z.string().trim().min(1).max(40).nullable(),
    })
    .parse(await c.req.json());
  const settings = await loadSettings(c.env.DB);
  const rest = settings.owners.filter((m) => m.key !== key);
  // "bia" typed again is the Bia already named, not a second person.
  const known =
    person && settings.owners.find((m) => normalizeName(m.person) === normalizeName(person));
  const who = known ? known.person : person;
  await saveSettings(c.env.DB, {
    ...settings,
    owners: who ? [...rest, { key, person: who }].slice(-200) : rest,
  });
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

/**
 * Atualizar: Meu Pluggy reads every bank now (with the owner's session there, meupluggy.ts) and
 * this waits for it, then reads them here. Signed out, the banks are only read, and signIn says
 * the owner should sign in again.
 */
app.post("/banks/refresh", async (c) => {
  if (!configured(c.env)) return c.json({ ok: false, signIn: false });
  const asked = await askMeuPluggy(c.env, false);
  const failed = await syncAll(c.env.DB, pluggy(c.env, fetch), todayIn(new Date()));
  c.executionCtx.waitUntil(ceilingAfterRead(c.env));
  return c.json({
    ok: asked === "refreshed" && failed === 0,
    signIn: asked === "signed-out" || asked === "expired",
  });
});

/** Entrar no Meu Pluggy: starts a sign-in; the app opens the page this returns. */
app.post("/banks/meu-pluggy", async (c) => {
  try {
    return c.json({ url: await beginSignIn(c.env.DB, c.env, fetch) });
  } catch (error) {
    console.error("meu pluggy sign-in failed", error);
    Sentry.captureException(error);
    return c.json({ error: "Não consegui abrir o Meu Pluggy. Tente mais tarde." }, 502);
  }
});

/**
 * Asks Meu Pluggy to refresh every bank; a failure there never stops the read that follows. A
 * scheduled refresh that finds the session over says so once, by push and to the phone.
 */
const askMeuPluggy = async (env: Env, scheduled: boolean) => {
  const asked = await refreshBanks(env.DB, env, fetch).catch((error) => {
    console.error("meu pluggy refresh failed", error);
    Sentry.captureException(error);
    return "failed" as const;
  });
  if (scheduled && asked === "expired")
    await raiseNotice(env, "meu-pluggy", todayIn(new Date()), signInReminder);
  return asked;
};

/**
 * 06:00 and half an hour before the evening message (and right after a sign-in): Meu Pluggy reads
 * every bank, then Neko reads them all and makes sure Pluggy knows where to send news.
 */
const bankSync = async (env: Env) => {
  if (!configured(env)) return;
  const api = pluggy(env, fetch);
  try {
    if (env.SITE_URL && env.PLUGGY_WEBHOOK_SECRET)
      await ensureWebhook(api, `${env.SITE_URL}/api/pluggy/webhook`, env.PLUGGY_WEBHOOK_SECRET);
  } catch (error) {
    console.error("pluggy webhook setup failed", error);
  }
  await askMeuPluggy(env, true);
  const failed = await syncAll(env.DB, api, todayIn(new Date()));
  if (failed > 0) Sentry.captureMessage(`bank sync: ${failed} bank(s) failed`);
  await ceilingAfterRead(env);
};

/**
 * After the banks are read: the ceiling crossing a mark is said then, not the next morning. A
 * failure here never fails the read.
 */
const ceilingAfterRead = async (env: Env) => {
  try {
    await checkCeiling(env, await getProjection(env, todayIn(new Date())));
  } catch (error) {
    console.error("ceiling check failed", error);
    Sentry.captureException(error);
  }
};

/** First day of the next month, when a paused Mia comes back. */
const nextMonthStart = (today: string) => {
  const [y = 0, m = 1] = today.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
};

/** Whether Mia is on, and how much of the month's cap is spent (specs/004-mia). */
app.get("/mia", async (c) => {
  const today = todayIn(new Date());
  if (!c.env.ANTHROPIC_API_KEY) return c.json(miaStatus(false, 0, today, 1));
  const spent = await spentThisMonth(c.env.DB, today);
  return c.json(miaStatus(true, spent, today, mia2On(c.env) ? 2 : 1));
});

const miaStatus = (on: boolean, spent: number, today: string, versao: 1 | 2): MiaStatus => ({
  ligada: on,
  usadoPct: Math.min(100, Math.floor((spent / CAP_MICRO_USD) * 100)),
  pausadaAte: spent >= CAP_MICRO_USD ? nextMonthStart(today) : null,
  versao,
});

/** Mia 2 needs the API key, the token her agent reads the Neko with, and this site's address. */
const mia2On = (env: Env) => Boolean(env.ANTHROPIC_API_KEY && env.MIA_MCP_TOKEN && env.SITE_URL);

const Mia2AskBody = z.object({
  pergunta: z.string().trim().min(1).max(1000),
  sessao: z
    .string()
    .regex(/^sesn_[A-Za-z0-9]{8,64}$/)
    .optional(),
});

/**
 * Mia 2 (mia2.ts): one question, answered as NDJSON lines while her agent works. The turn runs to
 * its end even when the phone leaves, so her chart calls are answered and the cost is booked.
 */
app.post("/mia2", async (c) => {
  const { ANTHROPIC_API_KEY: key, MIA_MCP_TOKEN: token, SITE_URL: site } = c.env;
  if (!key || !token || !site) throw new HTTPException(404);
  const parsed = Mia2AskBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new HTTPException(400);
  const today = todayIn(new Date());
  const spent = await spentThisMonth(c.env.DB, today);
  if (spent >= CAP_MICRO_USD) return c.json({ pausadaAte: nextMonthStart(today) }, 429);
  // Loaded on her first question only: the SDK stays out of every other request's start-up.
  const [{ default: Anthropic }, { ensureSetup, runTurn }] = await Promise.all([
    import("@anthropic-ai/sdk"),
    import("./mia2.ts"),
  ]);
  const client = new Anthropic({ apiKey: key });
  const setup = await ensureSetup(client, c.env.DB, site, token);
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  let open = true;
  const write = (line: Mia2Line) => {
    if (!open) return;
    writer.write(encoder.encode(`${JSON.stringify(line)}\n`)).catch(() => {
      open = false;
    });
  };
  const deps = { client, db: c.env.DB, today, now: () => new Date(), spentMicroUsd: spent, write };
  const turn = runTurn(deps, setup, parsed.data)
    .catch((e) => {
      console.error("mia2", e);
      Sentry.captureException(e);
      write({ t: "erro", motivo: "falha" });
    })
    .finally(() => writer.close().catch(() => undefined));
  c.executionCtx.waitUntil(turn);
  return new Response(readable, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
});

/** Her latest routine while it is news (routines.ts): the app shows each once, then it is a chat. */
app.get("/mia2/rotina", async (c) => {
  if (!mia2On(c.env)) return c.json({ rotina: null });
  const { loadRoutine } = await import("./routines.ts");
  return c.json({ rotina: await loadRoutine(c.env.DB, todayIn(new Date())) });
});

/**
 * Sunday's week and the 1st's month, by Mia herself (routines.ts), once the banks are fresh: her
 * answer waits on the Mia screen and the phone is told. Any other day, and past the month's cap,
 * nothing happens.
 */
const miaRoutine = async (env: Env) => {
  const { ANTHROPIC_API_KEY: key, MIA_MCP_TOKEN: token, SITE_URL: site } = env;
  const today = todayIn(new Date());
  if (!key || !token || !site) return;
  const routines = await import("./routines.ts");
  if (!routines.routineFor(today)) return;
  const spent = await spentThisMonth(env.DB, today);
  if (spent >= CAP_MICRO_USD) return;
  const [{ default: Anthropic }, { ensureSetup }] = await Promise.all([
    import("@anthropic-ai/sdk"),
    import("./mia2.ts"),
  ]);
  const client = new Anthropic({ apiKey: key });
  await routines.runRoutine({
    client,
    db: env.DB,
    today,
    now: () => new Date(),
    spentMicroUsd: spent,
    setup: await ensureSetup(client, env.DB, site, token),
    notify: (r) => raiseNotice(env, "mia", today, routines.routineReminder(r)),
  });
};

/** Stop: her turn is interrupted; the open answer ends on its own and keeps what she said. */
app.post("/mia2/parar", async (c) => {
  const { ANTHROPIC_API_KEY: key } = c.env;
  if (!mia2On(c.env) || !key) throw new HTTPException(404);
  const parsed = Mia2AskBody.pick({ sessao: true })
    .required()
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new HTTPException(400);
  const [{ default: Anthropic }, { stopTurn }] = await Promise.all([
    import("@anthropic-ai/sdk"),
    import("./mia2.ts"),
  ]);
  const ok = await stopTurn(new Anthropic({ apiKey: key }), c.env.DB, parsed.data.sessao);
  if (!ok) throw new HTTPException(404);
  return c.body(null, 204);
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

/**
 * Mia 2's tools over MCP (mcp.ts): read only, for the agent holding the token. Off without the
 * secret; a wrong token learns nothing but 401.
 */
app.all("/mcp", async (c) => {
  const token = c.env.MIA_MCP_TOKEN ?? "";
  if (!token) throw new HTTPException(404);
  const auth = c.req.header("authorization") ?? "";
  if (!auth.startsWith("Bearer ") || !sameSecret(auth.slice(7), token))
    return c.json({ error: "unauthorized" }, 401, { "WWW-Authenticate": "Bearer" });
  // Loaded on the first call only: the MCP SDK stays out of every other request's start-up.
  const { serveMcp } = await import("./mcp.ts");
  return serveMcp(
    c.req.raw,
    async () => {
      const [data, settings] = await Promise.all([
        getProjection(c.env, todayIn(new Date())),
        loadSettings(c.env.DB),
      ]);
      return { data, ceiling: settings.cycleBudget === null ? null : cents(settings.cycleBudget) };
    },
    async (entry) => {
      const { saveProposal } = await import("./proposals.ts");
      await saveProposal(c.env.DB, entry, new Date());
    },
  );
});

/** Faturas › "Ler a fatura do banco". */
app.post("/statement", async (c) =>
  c.json(await takeStatement(c.env, await c.req.json().catch(() => null))),
);

/** The same for a script or service holding the inbox token, outside the e-mail route. */
app.post("/inbox/statement", async (c) => {
  const token = c.env.STATEMENT_INBOX_TOKEN ?? "";
  const auth = c.req.header("authorization") ?? "";
  if (!sameSecret(auth.replace(/^Bearer /, ""), token)) return c.json({ error: "forbidden" }, 403);
  return c.json(await takeStatement(c.env, await c.req.json().catch(() => null)));
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

/**
 * Simular (web and Android): the sheet's balances under a pace and what-ifs. Read only: nothing
 * is stored, and the sheet is never touched.
 */
/** Simular's ask as the engine takes it: the projection, the ceiling, the pace and the what-ifs. */
interface ScenarioAsk {
  readonly data: Awaited<ReturnType<typeof getProjection>>;
  readonly ceiling: Cents | null;
  readonly pace: Pace | undefined;
  readonly changes: Change[];
}

const scenarioRoute = (answer: (ask: ScenarioAsk) => unknown) => async (c: Context<AppEnv>) => {
  const body = ScenarioBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 400);
  const [data, settings] = await Promise.all([
    getProjection(c.env, todayIn(new Date())),
    loadSettings(c.env.DB),
  ]);
  try {
    return c.json(
      answer({
        data,
        ceiling: settings.cycleBudget === null ? null : cents(settings.cycleBudget),
        pace: body.data.pace,
        changes: body.data.changes.map((ch) =>
          ch.kind === "compra"
            ? { ...ch, amount: cents(ch.amount) }
            : { ...ch, amount: cents(ch.amount), date: localDate(ch.date) },
        ),
      }),
    );
  } catch (e) {
    if (e instanceof RangeError) return c.json({ error: "unavailable", detail: e.message }, 422);
    throw e;
  }
};
app.post(
  "/scenario",
  scenarioRoute((a) => scenarioView(a.data, a.ceiling, a)),
);
/** Android's Simular: every pace at once, so a tap on a chip never waits on the network. */
app.post(
  "/scenarios",
  scenarioRoute((a) => scenarioViews(a.data, a.ceiling, a.changes)),
);

/** Today's morning and evening messages, for the Android app to show itself (see notices.ts). */
app.get("/reminders", async (c) => {
  const now = new Date();
  const data = await getProjection(c.env, todayIn(now));
  const [eveningHour, notices] = await Promise.all([
    loadEveningHour(c.env.DB),
    recentNotices(c.env.DB, now),
  ]);
  return c.json(remindersView(data, { eveningHour, notices }));
});

/** The server's messages the phone may not have shown yet; read with the widget, every 3 hours. */
app.get("/notices", async (c) => c.json({ notices: await recentNotices(c.env.DB) }));

/**
 * A card purchase the phone read from the bank app's notification (phone.ts): kept to learn, and,
 * from a bank app released by hand, the ceiling moves at once; the answer carries the messages, so
 * a mark crossed shows on the phone right away.
 */
app.post("/purchases", async (c) => {
  await savePhonePurchase(c.env.DB, PhonePurchase.parse(await c.req.json()));
  await checkCeiling(c.env, await getProjection(c.env, todayIn(new Date())));
  return c.json({ notices: await recentNotices(c.env.DB) });
});

/** The words of a bank app's notice of a purchase or a card, kept 15 days to check the reading. */
app.post("/purchases/notice", async (c) => {
  await saveBankNotice(c.env.DB, BankNotice.parse(await c.req.json()));
  return c.body(null, 204);
});

app.get("/reminders/hour", async (c) => c.json({ eveningHour: await loadEveningHour(c.env.DB) }));

/** The evening message's hour, chosen in Ajustes: one for the account, browser and phone alike. */
app.put("/reminders/hour", async (c) => {
  const { hour } = z.object({ hour: z.literal(EVENING_HOURS) }).parse(await c.req.json());
  await saveEveningHour(c.env.DB, hour);
  return c.json({ eveningHour: hour });
});

app.get("/history", async (c) => {
  const points = await monthEndHistory(c.env.DB, todayIn(new Date()));
  return c.json({ points, delta: historyDelta(points) });
});

app.get("/settings", async (c) => c.json(await loadSettings(c.env.DB)));

/** One screen opened or button used, by name only (shared/usage.ts); Ajustes reads the summary. */
app.post("/usage", async (c) => {
  const { event, app: from } = UsagePost.parse(await c.req.json());
  await recordUse(c.env.DB, todayIn(new Date()), event, from);
  return c.body(null, 204);
});

app.get("/usage", async (c) => c.json(await usageSummary(c.env.DB, todayIn(new Date()))));

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
const BANKS = "0 9 * * *"; // 06:00, before the morning message; then Mia's routine (routines.ts)
// The evening message comes at the owner's hour (19:00 to 23:00, Ajustes), with the banks read half
// an hour before: each run checks the hour and does its part, or nothing.
const EVENING_BANKS = "30 21-23,0-1 * * *"; // 18:30 to 22:30
const EVENING = "0 22-23,0-2 * * *"; // 19:00 to 23:00

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
   * fatura@ on the Neko domain: the bank's bill PDF, read like one sent from Faturas, and Meu
   * Pluggy's sign-in link, after which the banks are refreshed at once.
   */
  async email(message, env, ctx) {
    await receiveEmail(message, env, takeStatement, new Date(), {
      signedIn: () =>
        ctx.waitUntil(
          Promise.all([clearNotices(env.DB, "meu-pluggy"), bankSync(env)]).catch((error) =>
            Sentry.captureException(error),
          ),
        ),
    });
  },
  /**
   * 08:00 in São Paulo: refresh the projection, record the day's point in the forecast history
   * and send the morning message, if there is something to do. At the evening hour: what waits in
   * Para lançar, or the nudge to log the day.
   */
  async scheduled(event, env, ctx) {
    if (event.cron === BANKS) {
      // Fresh banks for the morning, and a safety net for webhooks Pluggy gave up on. Then, on
      // Sunday and on the 1st, Mia's routine reads them.
      ctx.waitUntil(
        bankSync(env)
          .catch((error) => Sentry.captureException(error))
          .then(() => miaRoutine(env))
          .catch((error) => Sentry.captureException(error)),
      );
      return;
    }
    if (event.cron === EVENING_BANKS || event.cron === EVENING) {
      const job = eveningJob(clockIn(new Date(event.scheduledTime)), await loadEveningHour(env.DB));
      // Half an hour before the message: Para lançar then shows the day's purchases.
      if (job === "banks")
        ctx.waitUntil(bankSync(env).catch((error) => Sentry.captureException(error)));
      if (job !== "message") return;
    }
    const run = async () => {
      const today = todayIn(new Date());
      // Housekeeping does not depend on the sheet: a failed read must not let the cache grow.
      if (event.cron === MORNING)
        await Promise.all([
          pruneSnapshots(env.DB),
          pruneSessions(env.DB),
          pruneNotices(env.DB),
          prunePhonePurchases(env.DB),
        ]).catch((error) => console.error("pruning failed", error));
      let data: Awaited<ReturnType<typeof getProjection>>;
      try {
        data = await getProjection(env, today);
      } catch (error) {
        console.error("scheduled sheet read failed", error);
        Sentry.captureException(error);
        await raiseNotice(env, "planilha", today, readFailedMessage(error));
        return;
      }
      await clearNotices(env.DB, "planilha");
      if (event.cron === MORNING) {
        await backfillEdits(env).catch((error) => console.error("revision backfill failed", error));
        const morning = morningMessage(data);
        if (morning) await sendReminder(env, morning);
      } else {
        const evening = eveningMessage(data);
        if (evening) await sendReminder(env, evening);
      }
    };
    ctx.waitUntil(run());
  },
} satisfies ExportedHandler<Env>);
