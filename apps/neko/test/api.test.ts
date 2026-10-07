import { describe, expect, it } from "vitest";
import type { Env } from "../src/worker/env.ts";
import worker from "../src/worker/index.ts";

const env = {
  SHEET_ID: "sheet",
  ALLOWED_EMAILS: "dono@example.com",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_SERVICE_ACCOUNT_JSON: "",
  SESSION_SECRET: "test-secret",
} as unknown as Env;

const call = (path: string, init?: RequestInit) =>
  worker.fetch(new Request(`https://neko.test${path}`, init) as never, env, {} as ExecutionContext);

describe("api", () => {
  it("every finance route needs a session", async () => {
    for (const path of ["/api/projection", "/api/history", "/api/settings"]) {
      expect((await call(path)).status).toBe(401);
    }
  });
  it("reports login as not configured while there is no Google client id", async () => {
    expect(await (await call("/api/config")).json()).toEqual({ googleClientId: null });
    const res = await call("/api/auth/google", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credential: "x" }),
    });
    expect(res.status).toBe(503);
  });
  it("refuses a form-like post from another site and sends strict headers", async () => {
    const res = await call("/api/auth/logout", {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "text/plain" },
      body: "{}",
    });
    expect(res.status).toBe(403);
    const ok = await call("/api/config");
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
  });
  it("takes client error reports only from a signed-in device", async () => {
    const res = await call("/api/client-error", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://neko.test" },
      body: JSON.stringify({ message: "boom", url: "/" }),
    });
    expect(res.status).toBe(401);
  });
  it("rejects a forged session cookie", async () => {
    const res = await call("/api/projection", {
      headers: { cookie: "neko_session=dono@example.com|9999999999999.fake" },
    });
    expect(res.status).toBe(401);
  });
});
