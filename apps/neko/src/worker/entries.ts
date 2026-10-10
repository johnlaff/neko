import {
  addDays,
  type CardConfig,
  type CellDraft,
  cents,
  type Draft,
  EntryError,
  type LocalDate,
  localDate,
  MAX_INSTALLMENTS,
  type Placement,
  placeDraft,
  todayIn,
} from "@neko/engine";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Env } from "./env.ts";
import { accessToken, WRITE_SCOPES } from "./google.ts";
import { getProjection } from "./pipeline.ts";
import { loadSettings, saveSettings } from "./settings.ts";
import {
  commitEntry,
  googleSheets,
  previewEntry,
  undoEntry,
  WriteError,
  writeForecast,
} from "./writer.ts";

/**
 * Launching into the sheet (specs/005-lancamentos, Fase 2): preview, launch, undo, and the answers
 * to Para lançar. Only on the owner's tap, one write at a time, and never with writing switched
 * off in Ajustes. The app sends drafts, never cells: the cells come from the engine here.
 */

const Day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .transform((s) => localDate(s));
const Money = z.number().int().nonnegative().max(100_000_000_00);
const Text = z.string().trim().min(1).max(80);
const Line = z.object({
  date: Day,
  column: z.enum(["entrada", "saida", "diario"]),
  section: z.string().max(40).nullable(),
  description: z.string().max(120),
  amount: Money,
});

export const DraftSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("new"),
    kind: z.enum([
      "entrada",
      "diario",
      "conta",
      "investimento",
      "reserva",
      "resgate",
      "saida",
      "cartao",
    ]),
    amount: Money,
    date: Day,
    description: Text,
    card: z.string().max(60).optional(),
    installments: z.number().int().min(1).max(MAX_INSTALLMENTS).optional(),
  }),
  z.object({
    type: z.literal("fix"),
    line: Line,
    amount: Money,
    date: Day,
    description: Text,
  }),
  z.object({
    type: z.literal("card"),
    card: Text,
    bills: z
      .array(z.object({ due: Day, was: Money, amount: Money }))
      .min(1)
      .max(30),
    also: z
      .array(z.object({ line: Line, amount: Money }))
      .max(30)
      .optional(),
  }),
  z.object({
    type: z.literal("forecast"),
    value: Money,
    days: z.array(Day).min(1).max(800),
  }),
]);

const Preview = z.object({ draft: DraftSchema });
const Commit = z.object({
  id: z.string().uuid(),
  draft: DraftSchema,
  /** From a preview the owner saw; without it, the write checks each line's value as it goes. */
  fingerprints: z.array(z.string().max(64)).max(60).optional(),
  key: z.string().max(300).optional(),
});

/** How long a write may hold the lock: a crashed one frees it by itself. */
const LOCK_MS = 120_000;

/** One write at a time across every request: the Saldo check must see only its own change. */
export const withLock = async <T>(db: D1Database, run: () => Promise<T>): Promise<T> => {
  const now = Date.now();
  const got = await db
    .prepare(
      "INSERT INTO setting (key, value) VALUES ('write_lock', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE CAST(setting.value AS INTEGER) < ?",
    )
    .bind(String(now + LOCK_MS), now)
    .run();
  if ((got.meta.changes ?? 0) === 0) throw new Busy();
  try {
    return await run();
  } finally {
    await db.prepare("DELETE FROM setting WHERE key = 'write_lock'").run();
  }
};

export class Busy extends Error {}

const writerApi = async (env: Env) => {
  const key = env.NEKO_WRITER_SERVICE_ACCOUNT_JSON;
  if (!key) return null;
  return googleSheets(env.SHEET_ID, await accessToken(key, Date.now(), WRITE_SCOPES));
};

const place = (draft: CellDraft, cards: readonly CardConfig[]): Placement[] => {
  try {
    return placeDraft(draft, cards);
  } catch (e) {
    if (e instanceof EntryError) throw new WriteError(e.message);
    throw e;
  }
};

export const entries = new Hono<AppEnv>();

entries.onError((err, c) => {
  if (err instanceof Busy)
    return c.json({ error: "busy", message: "outro lançamento está gravando" }, 409);
  if (err instanceof WriteError) return c.json({ error: "write", message: err.message }, 422);
  throw err;
});

/** Writing must be on, and the writer key set, before anything is read for a write. */
entries.use(async (c, next) => {
  if (!c.env.NEKO_WRITER_SERVICE_ACCOUNT_JSON)
    return c.json({ error: "writing-off", message: "o Neko ainda não pode gravar" }, 503);
  if (!(await loadSettings(c.env.DB)).writing)
    return c.json({ error: "writing-off", message: "lançar está desligado em Ajustes" }, 409);
  await next();
});

/** What launching would change, read from the sheet now; nothing is written. */
entries.post("/preview", async (c) => {
  const { draft } = Preview.parse(await c.req.json());
  // The Diário previsto reads and checks each day itself when it writes: nothing to preview.
  if (draft.type === "forecast") return c.json({ parts: [] });
  const { cardsKnown } = await getProjection(c.env, todayIn(new Date()));
  const api = await writerApi(c.env);
  if (!api) throw new WriteError("o Neko ainda não pode gravar");
  const parts = await previewEntry(api, place(draft as CellDraft, cardsKnown));
  return c.json({ parts });
});

/** Launches a draft whose preview the owner saw; the same id sent twice writes once. */
entries.post("/", async (c) => {
  const body = Commit.parse(await c.req.json());
  const draft = body.draft as Draft;
  const env = c.env;
  const data = await getProjection(env, todayIn(new Date()));
  const api = await writerApi(env);
  if (!api) throw new WriteError("o Neko ainda não pode gravar");
  const result = await withLock(env.DB, () =>
    draft.type === "forecast"
      ? writeForecast(env.DB, api, body.id, draft.days, draft.value)
      : commitEntry(env.DB, api, body.id, place(draft, data.cardsKnown), body.fingerprints),
  );
  if (result.state === "done" && body.key) {
    await env.DB.prepare(
      "INSERT INTO queue_decision (key, state, entry_id, created_at) VALUES (?, 'launched', ?, ?) ON CONFLICT(key) DO UPDATE SET state = 'launched', entry_id = excluded.entry_id",
    )
      .bind(body.key, body.id, new Date().toISOString())
      .run();
    // A Pix launched as savings: the next one from the same origin is proposed as savings.
    const item = data.bank?.queue?.find((i) => i.key === body.key);
    if (item?.kind === "diario" && draft.type === "new" && draft.kind === "reserva") {
      const origin = item.origin ?? "";
      const settings = await loadSettings(env.DB);
      if (origin !== "" && !settings.savedOrigins.includes(origin))
        await saveSettings(env.DB, {
          ...settings,
          savedOrigins: [...settings.savedOrigins, origin].slice(-100),
        });
    }
  }
  return c.json(result);
});

/**
 * The Diário previsto, from Ajustes: every day from today to the end of the last year tab gets
 * `value` (the days the owner wrote in stay as they are), and 0 takes Neko's forecast away. The
 * value is saved only once the sheet has it.
 */
entries.post("/previsto", async (c) => {
  const { value } = z.object({ value: Money.max(10_000_00) }).parse(await c.req.json());
  const env = c.env;
  const today = todayIn(new Date());
  const data = await getProjection(env, today);
  const last = Math.max(
    ...Object.keys(data.sheet.tabs)
      .filter((t) => /^\d{4}$/.test(t))
      .map(Number),
  );
  const days: LocalDate[] = [];
  for (let d = today; d.slice(0, 4) <= String(last); d = addDays(d, 1)) days.push(d);
  if (days.length === 0) throw new WriteError("a planilha não tem a aba deste ano");
  const api = await writerApi(env);
  if (!api) throw new WriteError("o Neko ainda não pode gravar");
  const result = await withLock(env.DB, () =>
    writeForecast(env.DB, api, crypto.randomUUID(), days, cents(value)),
  );
  if (result.state === "done") {
    const settings = await loadSettings(env.DB);
    const undo = {
      entry: result.entryId,
      dailyForecast: settings.dailyForecast,
      since: settings.previstoSince,
    };
    await saveSettings(
      env.DB,
      value > 0
        ? { ...settings, dailyForecast: value, previstoSince: today, previstoUndo: undo }
        : { ...settings, previstoSince: null, previstoUndo: undo },
    );
  }
  return c.json(result);
});

/** Puts every cell back as it was, if the owner did not change it since; the item comes back. */
entries.post("/:id/undo", async (c) => {
  const id = z.string().uuid().parse(c.req.param("id"));
  const env = c.env;
  const api = await writerApi(env);
  if (!api) throw new WriteError("o Neko ainda não pode gravar");
  const result = await withLock(env.DB, () => undoEntry(env.DB, api, id));
  await env.DB.prepare("DELETE FROM queue_decision WHERE entry_id = ?").bind(id).run();
  // Desfazer after filling or changing the Diário previsto puts its setting back too.
  const settings = await loadSettings(env.DB);
  const before = settings.previstoUndo;
  if (result.state === "undone" && before?.entry === id)
    await saveSettings(env.DB, {
      ...settings,
      dailyForecast: before.dailyForecast,
      previstoSince: before.since,
      previstoUndo: null,
    });
  return c.json(result);
});

/** Para lançar answers that write nothing to the sheet: ignore an item, or say what an account is. */
export const queue = new Hono<AppEnv>();

queue.post("/ignore", async (c) => {
  const { key } = z.object({ key: z.string().min(1).max(300) }).parse(await c.req.json());
  await c.env.DB.prepare(
    "INSERT INTO queue_decision (key, state, entry_id, created_at) VALUES (?, 'ignored', NULL, ?) ON CONFLICT(key) DO NOTHING",
  )
    .bind(key, new Date().toISOString())
    .run();
  return c.json({ ok: true });
});

/** Desfazer after Ignorar: the item comes back. Only an ignored key; a launched one undoes by its entry. */
queue.post("/unignore", async (c) => {
  const { key } = z.object({ key: z.string().min(1).max(300) }).parse(await c.req.json());
  await c.env.DB.prepare("DELETE FROM queue_decision WHERE key = ? AND state = 'ignored'")
    .bind(key)
    .run();
  return c.json({ ok: true });
});

/** The review every 3 months, answered "keep it": the next one comes 3 months from today. */
queue.post("/previsto/manter", async (c) => {
  const settings = await loadSettings(c.env.DB);
  if (settings.previstoSince !== null)
    await saveSettings(c.env.DB, { ...settings, previstoSince: todayIn(new Date()) });
  return c.json({ ok: true });
});

queue.post("/account", async (c) => {
  const { account, use } = z
    .object({ account: z.string().min(1).max(64), use: z.enum(["guardado", "corrente"]) })
    .parse(await c.req.json());
  const settings = await loadSettings(c.env.DB);
  await saveSettings(c.env.DB, {
    ...settings,
    accountUse: { ...settings.accountUse, [account]: use },
  });
  return c.json({ ok: true });
});
