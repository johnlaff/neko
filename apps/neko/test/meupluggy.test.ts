import { describe, expect, it } from "vitest";
import type { Env } from "../src/worker/env.ts";
import { receiveEmail } from "../src/worker/inbox.ts";
import {
  beginSignIn,
  finishSignIn,
  refreshBanks,
  seal,
  signInLink,
  unseal,
} from "../src/worker/meupluggy.ts";
import { sqliteD1 } from "./d1.ts";

// Invented account, items and tokens (public repo).
const SECRET = "segredo-de-teste";
const OWNER = "dono@example.com";
const STATE = "estado-inventado";
const NOW = new Date("2026-11-11T02:00:00Z");
const env = { SESSION_SECRET: SECRET, ALLOWED_EMAILS: OWNER } as unknown as Env;
const LINK = `https://my-pluggy.us.auth0.com/passwordless/verify_redirect?scope=openid&state=${STATE}&verification_code=123456&connection=email`;

/**
 * meu.pluggy.ai, its Auth0 and Pluggy's API, as the owner's HAR showed them: cookies set by
 * redirects, a session the site renews on every answer, and banks that take a moment to update.
 */
const fakeSite = (opts: { session?: string; expired?: boolean } = {}) => {
  const calls: string[] = [];
  const updating = new Map<string, number>();
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const cookie = headers.get("cookie") ?? "";
    calls.push(`${method} ${url.host}${url.pathname} ${cookie}`.trim());
    const answer = (status: number, body?: unknown, extra: Record<string, string> = {}) => {
      const h = new Headers(extra);
      return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: h });
    };
    const go = (location: string, cookies: string[] = []) => {
      const h = new Headers({ location });
      for (const c of cookies) h.append("set-cookie", c);
      return new Response(null, { status: 302, headers: h });
    };
    const path = `${url.host}${url.pathname}`;
    if (path === "meu.pluggy.ai/api/auth/login")
      return go("https://my-pluggy.us.auth0.com/authorize?client_id=c", [
        "auth_verification=verificador; Path=/; HttpOnly",
      ]);
    if (path === "my-pluggy.us.auth0.com/authorize")
      return go(`/login?state=${STATE}&client=c`, ["auth0=transacao; Path=/", "did=aparelho"]);
    if (path === "my-pluggy.us.auth0.com/passwordless/verify_redirect")
      return cookie.includes("auth0=transacao")
        ? go("/authorize/resume?state=x")
        : answer(400, { error: "no transaction" });
    if (path === "my-pluggy.us.auth0.com/authorize/resume")
      return go(`https://meu.pluggy.ai/api/auth/callback?code=c&state=${STATE}`);
    if (path === "meu.pluggy.ai/api/auth/callback")
      return cookie.includes("auth_verification=verificador")
        ? go("/overview", ["auth_verification=; Max-Age=0; Path=/", "appSession=sessao-1; Path=/"])
        : answer(400);
    if (path === "meu.pluggy.ai/api/me")
      return opts.expired
        ? answer(401, { error: "not_authenticated" })
        : answer(200, { email: OWNER }, { "set-cookie": "appSession=sessao-2; Path=/" });
    if (path === "meu.pluggy.ai/api/my/items")
      return answer(200, [
        { id: "original-a", status: "UPDATED" },
        { id: "original-b", status: "UPDATED" },
      ]);
    if (path === "meu.pluggy.ai/api/connect-token") {
      const body = JSON.parse(String(init?.body));
      if (body.clientUserId !== `my-pluggy:${OWNER}`) return answer(403);
      return answer(201, { accessToken: `token-${body.itemId}` });
    }
    const item = /^api\.pluggy\.ai\/items\/(.+)$/.exec(path)?.[1];
    if (item) {
      if (headers.get("x-api-key") !== `token-${item}`) return answer(403);
      if (method === "PATCH") {
        updating.set(item, 2);
        return answer(200, { id: item, status: "UPDATING" });
      }
      const left = (updating.get(item) ?? 1) - 1;
      updating.set(item, left);
      return answer(200, { id: item, status: left > 0 ? "UPDATING" : "UPDATED" });
    }
    return answer(404);
  }) as typeof fetch;
  return { f, calls };
};

const signedIn = async (session = "sessao-1") => {
  const db = sqliteD1();
  db.sqlite
    .prepare("INSERT INTO meu_pluggy (id, session) VALUES (1, ?)")
    .run(await seal(SECRET, { appSession: session }));
  return db;
};

const stored = (db: ReturnType<typeof sqliteD1>) =>
  db.sqlite.prepare("SELECT * FROM meu_pluggy").get() as Record<string, string | null>;

describe("Meu Pluggy sign-in", () => {
  it("keeps the cookies only encrypted, and only this secret opens them", async () => {
    const sealed = await seal(SECRET, { appSession: "sessao" });
    expect(sealed).not.toContain("sessao");
    expect(await unseal(SECRET, sealed)).toEqual({ appSession: "sessao" });
    await expect(unseal("outro-segredo", sealed)).rejects.toThrow();
  });

  it("finds the link in the e-mail, as text or as HTML", () => {
    expect(signInLink(`Entre: ${LINK}\n\nObrigado`)).toBe(LINK);
    expect(signInLink(`<a href="${LINK.replaceAll("&", "&amp;")}">Entre</a>`)).toBe(LINK);
    expect(signInLink("https://example.com/passwordless/verify_redirect?state=x")).toBeNull();
  });

  it("begins on Neko's side and ends with the e-mailed link opened with the same cookies", async () => {
    const db = sqliteD1();
    const site = fakeSite();
    const page = await beginSignIn(db as never, env, site.f, NOW);
    expect(page).toBe(`https://my-pluggy.us.auth0.com/login?state=${STATE}&client=c`);
    expect(stored(db)).toMatchObject({ session: null, pending_state: STATE });
    expect(await finishSignIn(db as never, env, site.f, LINK, NOW)).toBe(true);
    const row = stored(db);
    expect(row).toMatchObject({
      pending: null,
      pending_state: null,
      signed_in_at: NOW.toISOString(),
    });
    expect(await unseal(SECRET, row.session ?? "")).toEqual({ appSession: "sessao-1" });
    // The session came at the callback: the page after it is not fetched.
    expect(site.calls.some((c) => c.includes("/overview"))).toBe(false);
  });

  it("opens no link of another sign-in, nor one that came too late", async () => {
    const db = sqliteD1();
    const site = fakeSite();
    await beginSignIn(db as never, env, site.f, NOW);
    const other = LINK.replace(STATE, "estado-de-outro");
    expect(await finishSignIn(db as never, env, site.f, other, NOW)).toBe(false);
    expect(await finishSignIn(db as never, env, site.f, "nada", NOW)).toBe(false);
    const late = new Date(NOW.getTime() + 31 * 60_000);
    expect(await finishSignIn(db as never, env, site.f, LINK, late)).toBe(false);
    expect(stored(db).session).toBeNull();
  });
});

describe("Meu Pluggy refresh", () => {
  it("asks every bank with its own token, waits until each is done and keeps the renewed session", async () => {
    const db = await signedIn();
    const site = fakeSite();
    const waits: number[] = [];
    const asked = await refreshBanks(db as never, env, site.f, async (ms) => {
      waits.push(ms);
    });
    expect(asked).toBe("refreshed");
    expect(site.calls.filter((c) => c.startsWith("PATCH"))).toEqual([
      "PATCH api.pluggy.ai/items/original-a",
      "PATCH api.pluggy.ai/items/original-b",
    ]);
    expect(site.calls).toContain("GET meu.pluggy.ai/api/me appSession=sessao-1");
    expect(waits.length).toBeGreaterThan(0);
    expect(await unseal(SECRET, stored(db).session ?? "")).toEqual({ appSession: "sessao-2" });
  });

  it("without a session asks nothing, and an ended one is dropped for a new sign-in", async () => {
    const none = sqliteD1();
    expect(await refreshBanks(none as never, env, fakeSite().f)).toBe("signed-out");
    const db = await signedIn();
    const site = fakeSite({ expired: true });
    expect(await refreshBanks(db as never, env, site.f)).toBe("expired");
    expect(stored(db).session).toBeNull();
    expect(site.calls.some((c) => c.startsWith("PATCH"))).toBe(false);
  });
});

describe("Meu Pluggy e-mail at fatura@", () => {
  const mail = (envelope: string, body: string) => ({
    from: envelope,
    raw: new Response(
      [
        "From: Meu Pluggy <no-reply@pluggy.ai>",
        "To: fatura@neko.example",
        "Subject: Bem-vindo ao Meu Pluggy!",
        "Content-Type: text/plain; charset=utf-8",
        "",
        body,
        "",
      ].join("\r\n"),
    ).body as ReadableStream<Uint8Array>,
    setReject: () => {},
  });
  const take = async () => ({ ok: true }) as never;

  it("forwarded by the owner, finishes the sign-in Neko began and refreshes the banks", async () => {
    const db = sqliteD1();
    const site = fakeSite();
    const withDb = { ...env, DB: db } as unknown as Env;
    await beginSignIn(db as never, env, site.f, NOW);
    let refreshed = 0;
    await receiveEmail(
      mail("dono+caf_=fatura=neko.example@example.com", `Entre no Meu Pluggy: ${LINK}`),
      withDb,
      take,
      NOW,
      { fetch: site.f, signedIn: () => refreshed++ },
    );
    expect(refreshed).toBe(1);
    expect(stored(db).session).not.toBeNull();
  });

  it("from anyone else, opens nothing", async () => {
    const db = sqliteD1();
    const site = fakeSite();
    const withDb = { ...env, DB: db } as unknown as Env;
    await beginSignIn(db as never, env, site.f, NOW);
    let refreshed = 0;
    await receiveEmail(mail("alguem@example.com", LINK), withDb, take, NOW, {
      fetch: site.f,
      signedIn: () => refreshed++,
    });
    expect(refreshed).toBe(0);
    expect(stored(db).session).toBeNull();
  });
});
