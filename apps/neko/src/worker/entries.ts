import {
  type CardConfig,
  type Draft,
  EntryError,
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
import { commitEntry, googleSheets, previewEntry, undoEntry, WriteError } from "./writer.ts";

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
]);

const Preview = z.object({ draft: DraftSchema });
const Commit = z.object({
  id: z.string().uuid(),
  draft: DraftSchema,
  fingerprints: z.array(z.string().max(64)).max(60),
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

const place = (draft: Draft, cards: readonly CardConfig[]): Placement[] => {
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
  const { cardsKnown } = await getProjection(c.env, todayIn(new Date()));
  const api = await writerApi(c.env);
  if (!api) throw new WriteError("o Neko ainda não pode gravar");
  const parts = await previewEntry(api, place(draft as Draft, cardsKnown));
  return c.json({ parts });
});

/** Launches a draft whose preview the owner saw; the same id sent twice writes once. */
entries.post("/", async (c) => {
  const body = Commit.parse(await c.req.json());
  const draft = body.draft as Draft;
  const env = c.env;
  const data = await getProjection(env, todayIn(new Date()));
  const placements = place(draft, data.cardsKnown);
  const api = await writerApi(env);
  if (!api) throw new WriteError("o Neko ainda não pode gravar");
  const result = await withLock(env.DB, () =>
    commitEntry(env.DB, api, body.id, placements, body.fingerprints),
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

/** Puts every cell back as it was, if the owner did not change it since; the item comes back. */
entries.post("/:id/undo", async (c) => {
  const id = z.string().uuid().parse(c.req.param("id"));
  const env = c.env;
  const api = await writerApi(env);
  if (!api) throw new WriteError("o Neko ainda não pode gravar");
  const result = await withLock(env.DB, () => undoEntry(env.DB, api, id));
  await env.DB.prepare("DELETE FROM queue_decision WHERE entry_id = ?").bind(id).run();
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
