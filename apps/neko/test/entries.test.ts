import { describe, expect, it } from "vitest";
import { Busy, withLock } from "../src/worker/entries.ts";
import type { Env } from "../src/worker/env.ts";
import worker from "../src/worker/index.ts";
import { loadSettings, saveSettings } from "../src/worker/settings.ts";
import { hashToken } from "../src/worker/token.ts";
import { sqliteD1 } from "./d1.ts";

const setup = async (extra: Partial<Env> = {}) => {
  const d1 = sqliteD1();
  const db = d1 as unknown as D1Database;
  const far = new Date(Date.now() + 86_400_000).toISOString();
  await db
    .prepare(
      "INSERT INTO session (id_hash, email, device, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(await hashToken("t"), "dono@example.com", "Teste", far, far, far)
    .run();
  const env = {
    ALLOWED_EMAILS: "dono@example.com",
    SESSION_SECRET: "s",
    DB: db,
    ...extra,
  } as unknown as Env;
  const post = (path: string, body: unknown) =>
    worker.fetch(
      new Request(`https://neko.test/api${path}`, {
        method: "POST",
        headers: {
          cookie: "__Host-neko_session=t",
          "content-type": "application/json",
          origin: "https://neko.test",
        },
        body: JSON.stringify(body),
      }) as never,
      env,
      {} as ExecutionContext,
    );
  return { d1, db, post };
};

const draft = {
  type: "new",
  kind: "diario",
  amount: 1890,
  date: "2026-10-15",
  description: "Padaria",
};

describe("launch routes", () => {
  it("need a session", async () => {
    const res = await worker.fetch(
      new Request("https://neko.test/api/queue/ignore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }) as never,
      { DB: sqliteD1() } as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(401);
  });

  it("write nothing without the writer key, or with writing switched off in Ajustes", async () => {
    const off = await setup();
    expect((await off.post("/entries/preview", { draft })).status).toBe(503);
    const on = await setup({ NEKO_WRITER_SERVICE_ACCOUNT_JSON: "{}" });
    await saveSettings(on.db, { ...(await loadSettings(on.db)), writing: false });
    const res = await on.post("/entries/preview", { draft });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "writing-off" });
  });

  it("remember an ignored item and what an account is for", async () => {
    const { d1, db, post } = await setup();
    expect((await post("/queue/ignore", { key: "mov:abc" })).status).toBe(200);
    expect((await post("/queue/ignore", { key: "mov:abc" })).status).toBe(200);
    expect(d1.sqlite.prepare("SELECT key, state FROM queue_decision").all()).toEqual([
      { key: "mov:abc", state: "ignored" },
    ]);
    await post("/queue/account", { account: "acc-1", use: "guardado" });
    expect((await loadSettings(db)).accountUse).toEqual({ "acc-1": "guardado" });
  });
});

describe("one write at a time", () => {
  it("refuses a second write while one holds the lock, and frees it after", async () => {
    const db = sqliteD1() as unknown as D1Database;
    let release = () => {};
    const first = withLock(db, () => new Promise<void>((r) => (release = r)));
    await new Promise((r) => setTimeout(r, 10));
    await expect(withLock(db, async () => 1)).rejects.toBeInstanceOf(Busy);
    release();
    await first;
    expect(await withLock(db, async () => 2)).toBe(2);
  });
});
