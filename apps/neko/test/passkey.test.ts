import { describe, expect, it } from "vitest";
import type { Env } from "../src/worker/env.ts";
import worker from "../src/worker/index.ts";
import { hashToken } from "../src/worker/token.ts";

interface Invite {
  email: string;
  expires_at: string;
  used_at: string | null;
}

/** Just enough of D1 for the invite lookups: rows keyed by token hash. */
const fakeDb = (invites: Record<string, Invite>) => ({
  prepare: (sql: string) => ({
    bind: (...args: unknown[]) => ({
      first: async () =>
        sql.includes("passkey_invite") ? (invites[String(args[0])] ?? null) : null,
      run: async () => ({}),
    }),
  }),
  batch: async () => [],
});

const TOKEN = "convite-de-teste-com-mais-de-vinte-letras";
const later = new Date(Date.now() + 3_600_000).toISOString();
const earlier = new Date(Date.now() - 3_600_000).toISOString();

const envWith = async (invite: Partial<Invite> = {}) =>
  ({
    ALLOWED_EMAILS: "dono@example.com",
    SESSION_SECRET: "test-secret",
    DB: fakeDb({
      [await hashToken(TOKEN)]: {
        email: "dono@example.com",
        expires_at: later,
        used_at: null,
        ...invite,
      },
    }),
  }) as unknown as Env;

const post = async (env: Env, path: string, body: unknown, cookie?: string) =>
  worker.fetch(
    new Request(`https://neko.test/api/passkey/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }) as never,
    env,
    {} as ExecutionContext,
  );

const credential = { id: "abc", rawId: "abc", type: "public-key", response: {} };

describe("passkey", () => {
  it("stores only a hash of the invite token", async () => {
    expect(await hashToken(TOKEN)).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashToken(TOKEN)).not.toContain(TOKEN);
  });
  it("offers registration for a valid invite, bound to this host", async () => {
    const res = await post(await envWith(), "register/options", { invite: TOKEN });
    expect(res.status).toBe(200);
    const options = (await res.json()) as { rp: { id: string }; user: { name: string } };
    expect(options.rp.id).toBe("neko.test");
    expect(options.user.name).toBe("dono@example.com");
    expect(res.headers.get("set-cookie")).toContain("neko_webauthn=");
  });
  it("refuses unknown, used and expired invites", async () => {
    const env = await envWith();
    expect((await post(env, "register/options", { invite: `${TOKEN}x` })).status).toBe(403);
    const used = await envWith({ used_at: earlier });
    expect((await post(used, "register/options", { invite: TOKEN })).status).toBe(403);
    const expired = await envWith({ expires_at: earlier });
    expect((await post(expired, "register/options", { invite: TOKEN })).status).toBe(403);
  });
  it("refuses an invite whose email left the allowlist", async () => {
    const env = await envWith({ email: "outra@example.com" });
    expect((await post(env, "register/options", { invite: TOKEN })).status).toBe(403);
  });
  it("rejects a passkey response without a pending challenge", async () => {
    const env = await envWith();
    const reg = await post(env, "register/verify", { invite: TOKEN, response: credential });
    expect(reg.status).toBe(403);
    expect((await post(env, "login/verify", { response: credential })).status).toBe(403);
  });
  it("rejects a forged challenge cookie", async () => {
    const env = await envWith();
    const res = await post(env, "login/verify", { response: credential }, "neko_webauthn=x|9.fake");
    expect(res.status).toBe(403);
  });
});
