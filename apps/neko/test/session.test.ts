import { describe, expect, it } from "vitest";
import { deviceLabel, IDLE_DAYS, isLive } from "../src/worker/auth.ts";
import type { Env } from "../src/worker/env.ts";
import worker from "../src/worker/index.ts";
import { hashToken } from "../src/worker/token.ts";

interface Row {
  id_hash: string;
  email: string;
  device: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
}

/** The session table in memory, answering the statements the Worker sends. */
const sessionDb = (rows: Row[]) => ({
  rows,
  prepare: (sql: string) => ({
    bind: (...a: unknown[]) => {
      const run = async () => {
        if (sql.startsWith("INSERT INTO session")) {
          const [id_hash, email, device, created_at, last_seen_at, expires_at] = a as string[];
          rows.push({ id_hash, email, device, created_at, last_seen_at, expires_at } as Row);
        } else if (sql.startsWith("UPDATE session")) {
          const row = rows.find((r) => r.id_hash === a[1]);
          if (row) row.last_seen_at = String(a[0]);
        } else if (sql.includes("email = ? AND id_hash != ?")) {
          for (const r of rows.filter((r) => r.email === a[0] && r.id_hash !== a[1]))
            rows.splice(rows.indexOf(r), 1);
        } else if (sql.startsWith("DELETE FROM session WHERE id_hash")) {
          for (const r of rows.filter(
            (r) => r.id_hash === a[0] && (a.length < 2 || r.email === a[1]),
          ))
            rows.splice(rows.indexOf(r), 1);
        }
        return {};
      };
      return {
        run,
        first: async () => rows.find((r) => r.id_hash === a[0]) ?? null,
        all: async () => ({ results: rows.filter((r) => r.email === a[0]) }),
      };
    },
  }),
});

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const ahead = (ms: number) => new Date(Date.now() + ms).toISOString();
const HOUR = 3_600_000;

const setup = async (extra: Partial<Row> = {}) => {
  const db = sessionDb([
    {
      id_hash: await hashToken("token-deste-aparelho"),
      email: "dono@example.com",
      device: "iPhone · Safari",
      created_at: ago(5 * HOUR),
      last_seen_at: ago(2 * HOUR),
      expires_at: ahead(1000 * HOUR),
      ...extra,
    },
    {
      id_hash: await hashToken("token-do-notebook"),
      email: "dono@example.com",
      device: "Windows · Chrome",
      created_at: ago(50 * HOUR),
      last_seen_at: ago(40 * HOUR),
      expires_at: ahead(1000 * HOUR),
    },
  ]);
  const env = {
    ALLOWED_EMAILS: "dono@example.com",
    SESSION_SECRET: "test-secret",
    DB: db,
  } as unknown as Env;
  const call = (path: string, init: RequestInit = {}, token = "token-deste-aparelho") =>
    worker.fetch(
      new Request(`https://neko.test/api${path}`, {
        ...init,
        headers: { cookie: `__Host-neko_session=${token}`, ...init.headers },
      }) as never,
      env,
      {} as ExecutionContext,
    );
  return { db, call };
};

describe("sessions", () => {
  it("signs in with a token whose hash is on file, and slides its idle window", async () => {
    const { db, call } = await setup();
    const res = await call("/me");
    expect(await res.json()).toEqual({ email: "dono@example.com" });
    expect(Date.parse(db.rows[0]?.last_seen_at ?? "")).toBeGreaterThan(Date.now() - 60_000);
    expect(res.headers.get("set-cookie")).toMatch(/^__Host-neko_session=.*Path=\/.*Secure/);
  });
  it("refuses an unknown token, an idle one and one past its absolute limit", async () => {
    expect(await (await (await setup()).call("/me", {}, "inventado")).json()).toEqual({
      email: null,
    });
    const idle = await setup({ last_seen_at: ago((IDLE_DAYS + 1) * 24 * HOUR) });
    expect((await idle.call("/projection")).status).toBe(401);
    const old = await setup({ expires_at: ago(HOUR) });
    expect((await old.call("/projection")).status).toBe(401);
  });
  it("lists devices with this one first, and signs the others out", async () => {
    const { db, call } = await setup();
    const list = (await (await call("/sessions")).json()) as { device: string; current: boolean }[];
    expect(list.map((d) => [d.device, d.current])).toEqual([
      ["iPhone · Safari", true],
      ["Windows · Chrome", false],
    ]);
    const res = await call("/sessions/others", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(200);
    expect(db.rows.map((r) => r.device)).toEqual(["iPhone · Safari"]);
  });
  it("logging out deletes the session on the server, not just the cookie", async () => {
    const { db, call } = await setup();
    await call("/auth/logout", { method: "POST", headers: { "content-type": "application/json" } });
    expect(db.rows.map((r) => r.device)).toEqual(["Windows · Chrome"]);
    expect((await call("/projection")).status).toBe(401);
  });
  it("accepts push endpoints only from real push services", async () => {
    const { call } = await setup();
    const subscribe = (endpoint: string) =>
      call("/push/subscription", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint, keys: { p256dh: "k", auth: "a" } }),
      });
    expect((await subscribe("https://169.254.169.254/latest")).status).toBe(400);
    expect((await subscribe("https://fcm.googleapis.com.evil.example/x")).status).toBe(400);
    expect((await subscribe("https://fcm.googleapis.com/fcm/send/abc")).status).toBe(200);
  });
  it("a session stops working once its email leaves the allowlist", () => {
    const row = { email: "x@example.com", last_seen_at: ago(HOUR), expires_at: ahead(HOUR) };
    expect(isLive(row, ["dono@example.com"], Date.now())).toBe(false);
    expect(isLive(row, ["x@example.com"], Date.now())).toBe(true);
  });
  it("names devices by system and browser only", () => {
    expect(
      deviceLabel(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("iPhone · Safari");
    expect(
      deviceLabel(
        "Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36",
      ),
    ).toBe("Android · Chrome");
    expect(deviceLabel("")).toBe("Navegador");
  });
});
