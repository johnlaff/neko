import { z } from "zod";
import type { Env } from "./env.ts";
import type { Fetch } from "./pluggy.ts";
import type { Reminder } from "./push.ts";

/**
 * Making the banks refresh now (specs/003-open-finance). Pluggy's API refuses to update the
 * MeuPluggy items Neko reads (400 "MeuPluggy item cant be updated"); only meu.pluggy.ai can, for a
 * signed-in person, as its Atualizar button does. So Neko keeps the owner's session there,
 * encrypted, and uses it at the 06:00 and 21:00 refreshes, which keeps it from lapsing. Unofficial:
 * if the site changes, this stops, and the banks still refresh once a day on their own.
 *
 * Signing in: Meu Pluggy's login page asks servers for a captcha, so the owner's browser does that
 * one step. Neko starts the sign-in and keeps its cookies, the owner asks for the e-mailed link on
 * the page Neko opens, a Gmail filter forwards that e-mail to fatura@, and Neko opens the link
 * with the cookies it kept. Nothing here writes anywhere but this table.
 */

const SITE = "https://meu.pluggy.ai";
const SITE_HOST = "meu.pluggy.ai";
const AUTH0 = "my-pluggy.us.auth0.com";
const API = "https://api.pluggy.ai";
const AGENT = "Mozilla/5.0 (compatible; Neko)";
/** The e-mailed link lasts five minutes; a sign-in older than this is no longer waited for. */
const PENDING_MS = 30 * 60_000;

/** Cookies by host, as a browser keeps them; path and expiry do not matter for these few calls. */
export type Jar = Record<string, Record<string, string>>;

const keep = (jar: Jar, url: URL, res: Response) => {
  for (const line of res.headers.getSetCookie()) {
    const [pair = "", ...attributes] = line.split(";");
    const at = pair.indexOf("=");
    if (at < 1) continue;
    const name = pair.slice(0, at).trim();
    const value = pair.slice(at + 1).trim();
    const host = jar[url.host] ?? {};
    jar[url.host] = host;
    if (value === "" || attributes.some((a) => /^\s*max-age=0\s*$/i.test(a))) delete host[name];
    else host[name] = value;
  }
};

interface Call {
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string | null;
}

const visit = async (f: Fetch, jar: Jar, url: string, init: Call = {}) => {
  const u = new URL(url);
  const cookie = Object.entries(jar[u.host] ?? {})
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  const res = await f(u.toString(), {
    ...init,
    redirect: "manual",
    headers: { "user-agent": AGENT, ...(cookie ? { cookie } : {}), ...init.headers },
  });
  keep(jar, u, res);
  return res;
};

/** Where a redirect points, or null when the answer is the page itself. */
const next = (res: Response, from: string): string | null => {
  const location = res.headers.get("location");
  return res.status >= 300 && res.status < 400 && location
    ? new URL(location, from).toString()
    : null;
};

/** nextjs-auth0 names its cookie appSession, and splits a big one into appSession.0, .1… */
const hasSession = (cookies: Record<string, string> | undefined) =>
  Object.keys(cookies ?? {}).some((name) => /^appSession(\.\d+)?$/.test(name));

/** AES-GCM under a key derived from SESSION_SECRET: the cookies are a login, never kept plain. */
const key = async (secret: string) =>
  crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: new TextEncoder().encode("neko meu-pluggy"),
    },
    await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "HKDF", false, [
      "deriveKey",
    ]),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const bytes = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export const seal = async (secret: string, value: unknown): Promise<string> => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await key(secret),
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return `${base64(iv)}.${base64(new Uint8Array(data))}`;
};

export const unseal = async <T>(secret: string, sealed: string): Promise<T> => {
  const [iv = "", data = ""] = sealed.split(".");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes(iv) },
    await key(secret),
    bytes(data),
  );
  return JSON.parse(new TextDecoder().decode(plain)) as T;
};

interface Row {
  readonly session: string | null;
  readonly pending: string | null;
  readonly pending_state: string | null;
  readonly pending_at: string | null;
}

const row = (db: D1Database) =>
  db
    .prepare("SELECT session, pending, pending_state, pending_at FROM meu_pluggy WHERE id = 1")
    .first<Row>();

type Secret = Pick<Env, "SESSION_SECRET">;

/**
 * Starts a sign-in and returns Meu Pluggy's login page, for the owner to open and ask for the
 * e-mailed link there. A new one replaces any sign-in left unfinished.
 */
export const beginSignIn = async (
  db: D1Database,
  env: Secret,
  f: Fetch,
  now = new Date(),
): Promise<string> => {
  const jar: Jar = {};
  const start = `${SITE}/api/auth/login`;
  const authorize = next(await visit(f, jar, start), start);
  const login = authorize ? next(await visit(f, jar, authorize), authorize) : null;
  const page = login ? new URL(login) : null;
  const state = page?.searchParams.get("state");
  if (!page || page.host !== AUTH0 || page.pathname !== "/login" || !state)
    throw new Error("meu pluggy: no sign-in page");
  await db
    .prepare(
      `INSERT INTO meu_pluggy (id, pending, pending_state, pending_at) VALUES (1, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET pending = excluded.pending,
         pending_state = excluded.pending_state, pending_at = excluded.pending_at`,
    )
    .bind(await seal(env.SESSION_SECRET, jar), state, now.toISOString())
    .run();
  return page.toString();
};

/** The sign-in link in Meu Pluggy's e-mail, from its text or its HTML. */
export const signInLink = (text: string): string | null =>
  /https:\/\/my-pluggy\.us\.auth0\.com\/passwordless\/verify_redirect\?[^\s"'<>()]+/
    .exec(text)?.[0]
    ?.replace(/&amp;/g, "&") ?? null;

/**
 * Opens the e-mailed link with the cookies the sign-in began with. Only a link carrying the state
 * of the sign-in Neko started, while it is still fresh, is opened: any other is someone else's.
 */
export const finishSignIn = async (
  db: D1Database,
  env: Secret,
  f: Fetch,
  link: string,
  now = new Date(),
): Promise<boolean> => {
  const r = await row(db);
  const url = URL.canParse(link) ? new URL(link) : null;
  if (
    !url ||
    url.host !== AUTH0 ||
    url.pathname !== "/passwordless/verify_redirect" ||
    !r?.pending ||
    !r.pending_at ||
    url.searchParams.get("state") !== r.pending_state ||
    now.getTime() - Date.parse(r.pending_at) > PENDING_MS
  )
    return false;
  const jar = await unseal<Jar>(env.SESSION_SECRET, r.pending);
  // Auth0 → its callback → Meu Pluggy's callback, which sets the session and sends to a page.
  let at: string | null = url.toString();
  for (let hop = 0; at && hop < 8 && !hasSession(jar[SITE_HOST]); hop++)
    at = next(await visit(f, jar, at), at);
  if (!hasSession(jar[SITE_HOST])) return false;
  await db
    .prepare(
      `UPDATE meu_pluggy SET session = ?, signed_in_at = ?, pending = NULL, pending_state = NULL,
         pending_at = NULL WHERE id = 1`,
    )
    .bind(await seal(env.SESSION_SECRET, jar[SITE_HOST]), now.toISOString())
    .run();
  return true;
};

const Me = z.object({ email: z.string().min(3) });
const SiteItem = z.object({ id: z.string().min(1), status: z.string().nullish() });
const Token = z.object({ accessToken: z.string().min(1) });

/**
 * "refreshed": every bank was asked, and waited for until done (or about a minute passed).
 * "signed-out": no session to ask with. "expired": the session just ended; the owner signs in
 * again. Either way the banks are still read as Pluggy has them.
 */
export type Asked = "refreshed" | "signed-out" | "expired";

/**
 * Asks Meu Pluggy to read every bank now, as its Atualizar button does, and waits until each is
 * done; the webhook and the read after this bring the news. Each answer renews the session for
 * another day, so it is saved again.
 */
export const refreshBanks = async (
  db: D1Database,
  env: Secret,
  f: Fetch,
  wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<Asked> => {
  const r = await row(db);
  if (!r?.session) return "signed-out";
  const jar: Jar = { [SITE_HOST]: await unseal(env.SESSION_SECRET, r.session) };
  const site = (path: string, body?: unknown) =>
    visit(f, jar, `${SITE}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        accept: "application/json",
        "x-requested-with": "my-pluggy",
        ...(body ? { "content-type": "application/json", origin: SITE } : {}),
      },
      body: body ? JSON.stringify(body) : null,
    });
  const me = await site("/api/me");
  if (me.status === 401 || me.status === 403 || (me.status >= 300 && me.status < 400)) {
    await db.prepare("UPDATE meu_pluggy SET session = NULL WHERE id = 1").run();
    return "expired";
  }
  if (!me.ok) throw new Error(`meu pluggy /api/me: ${me.status}`);
  const { email } = Me.parse(await me.json());
  const items = z
    .array(SiteItem)
    .parse(await (await site("/api/my/items?only_my_items=true")).json());
  const asked: { id: string; token: string }[] = [];
  for (const item of items) {
    // One bank that refuses (its consent ended, say) must not stop the others.
    try {
      const { accessToken } = Token.parse(
        await (
          await site("/api/connect-token", { clientUserId: `my-pluggy:${email}`, itemId: item.id })
        ).json(),
      );
      const res = await f(`${API}/items/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        headers: { "x-api-key": accessToken, "content-type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      });
      if (res.ok) asked.push({ id: item.id, token: accessToken });
      else console.warn("meu pluggy: update refused", res.status);
    } catch (error) {
      console.warn("meu pluggy: update failed", error);
    }
  }
  await db
    .prepare("UPDATE meu_pluggy SET session = ? WHERE id = 1")
    .bind(await seal(env.SESSION_SECRET, jar[SITE_HOST] ?? {}))
    .run();
  // Each bank takes 3 to 15 seconds, all at once; one that hangs is not waited for past a minute.
  let waiting = asked;
  for (let round = 0; waiting.length > 0 && round < 20; round++) {
    await wait(3000);
    const still: typeof waiting = [];
    for (const a of waiting) {
      const res = await f(`${API}/items/${encodeURIComponent(a.id)}`, {
        headers: { "x-api-key": a.token },
      });
      if (res.ok && SiteItem.parse(await res.json()).status === "UPDATING") still.push(a);
    }
    waiting = still;
  }
  return "refreshed";
};

/** Sent once, when a scheduled refresh finds the session over. */
export const signInReminder: Reminder = {
  title: "Entre no Meu Pluggy de novo",
  body: "O Neko parou de atualizar os bancos na hora. Em Para lançar, toque em Atualizar e depois em Entrar.",
  url: "/",
  tag: "alert",
};
