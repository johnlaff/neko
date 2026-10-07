import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, getSignedCookie, setCookie } from "hono/cookie";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AppEnv, Env } from "./env.ts";
import { hashToken, randomToken } from "./token.ts";

/** Sent as `__Host-neko_session`: secure, this host only, whole site. */
const COOKIE = "neko_session";
/** The stateless cookie used before sessions lived in D1; read once to move the device over. */
const LEGACY_COOKIE = "neko_session";
const DAY = 86_400_000;
/** Unused this long, a device signs in again. */
export const IDLE_DAYS = 30;
/** However often it is used, a device signs in again after this. */
export const ABSOLUTE_DAYS = 90;
/** last_seen_at moves at most this often, so reading the app is not a write per request. */
const TOUCH_MS = 3_600_000;

const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export const allowedEmails = (env: Env) =>
  env.ALLOWED_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

/** Verifies a Google Identity Services credential and checks the allowlist. */
export const verifyGoogleCredential = async (
  env: Env,
  credential: string,
): Promise<string | null> => {
  const { payload } = await jwtVerify(credential, googleKeys, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: env.GOOGLE_CLIENT_ID,
  });
  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : null;
  if (!email || payload.email_verified !== true || !allowedEmails(env).includes(email)) return null;
  return email;
};

/** "iPhone · Safari": enough to tell devices apart in Ajustes, nothing more is kept. */
export const deviceLabel = (ua: string) => {
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "Mac"
            : /Linux/.test(ua)
              ? "Linux"
              : null;
  const browser = /EdgA?\//.test(ua)
    ? "Edge"
    : /SamsungBrowser\//.test(ua)
      ? "Samsung Internet"
      : /Firefox\/|FxiOS\//.test(ua)
        ? "Firefox"
        : /Chrome\/|CriOS\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : null;
  return [os, browser].filter(Boolean).join(" · ") || "Navegador";
};

const writeCookie = (c: Context<AppEnv>, token: string) =>
  setCookie(c, COOKIE, token, {
    prefix: "host",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: IDLE_DAYS * 86_400,
  });

export const startSession = async (c: Context<AppEnv>, email: string) => {
  const token = randomToken();
  const idHash = await hashToken(token);
  const now = Date.now();
  await c.env.DB.prepare(
    "INSERT INTO session (id_hash, email, device, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(
      idHash,
      email,
      deviceLabel(c.req.header("user-agent") ?? ""),
      new Date(now).toISOString(),
      new Date(now).toISOString(),
      new Date(now + ABSOLUTE_DAYS * DAY).toISOString(),
    )
    .run();
  writeCookie(c, token);
  deleteCookie(c, LEGACY_COOKIE, { path: "/", secure: true });
  return idHash;
};

export const endSession = async (c: Context<AppEnv>) => {
  const token = getCookie(c, COOKIE, "host");
  if (token)
    await c.env.DB.prepare("DELETE FROM session WHERE id_hash = ?")
      .bind(await hashToken(token))
      .run();
  deleteCookie(c, COOKIE, { path: "/", secure: true, prefix: "host" });
  deleteCookie(c, LEGACY_COOKIE, { path: "/", secure: true });
};

interface SessionRow {
  email: string;
  last_seen_at: string;
  expires_at: string;
}

export interface Session {
  email: string;
  idHash: string;
}

/** A session is live while its email is allowed, it was used recently and it is not too old. */
export const isLive = (row: SessionRow, allowed: readonly string[], now: number) =>
  allowed.includes(row.email) &&
  Date.parse(row.expires_at) > now &&
  Date.parse(row.last_seen_at) + IDLE_DAYS * DAY > now;

/** Devices signed in with the old signed cookie get a real session on their next request. */
const upgradeLegacy = async (c: Context<AppEnv>): Promise<Session | null> => {
  const value = await getSignedCookie(c, c.env.SESSION_SECRET, LEGACY_COOKIE);
  if (!value) return null;
  const [email, expires] = value.split("|");
  if (!email || Number(expires) < Date.now() || !allowedEmails(c.env).includes(email)) return null;
  return { email, idHash: await startSession(c, email) };
};

export const currentSession = async (c: Context<AppEnv>): Promise<Session | null> => {
  if (!c.env.SESSION_SECRET) return null;
  const token = getCookie(c, COOKIE, "host");
  if (!token) return upgradeLegacy(c);
  const idHash = await hashToken(token);
  const row = await c.env.DB.prepare(
    "SELECT email, last_seen_at, expires_at FROM session WHERE id_hash = ?",
  )
    .bind(idHash)
    .first<SessionRow>();
  const now = Date.now();
  if (!row || !isLive(row, allowedEmails(c.env), now)) return null;
  if (now - Date.parse(row.last_seen_at) > TOUCH_MS) {
    await c.env.DB.prepare("UPDATE session SET last_seen_at = ? WHERE id_hash = ?")
      .bind(new Date(now).toISOString(), idHash)
      .run();
    writeCookie(c, token);
  }
  return { email: row.email, idHash };
};

export const sessionEmail = async (c: Context<AppEnv>) => (await currentSession(c))?.email ?? null;

export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await currentSession(c);
  if (!session) return c.json({ error: "unauthenticated" }, 401);
  c.set("email", session.email);
  c.set("session", session.idHash);
  await next();
};

/** Drops ended sessions, the reminders of devices no longer signed in and stale challenges. */
export const pruneSessions = (db: D1Database, now = Date.now()) =>
  db.batch([
    db
      .prepare("DELETE FROM session WHERE expires_at < ? OR last_seen_at < ?")
      .bind(new Date(now).toISOString(), new Date(now - IDLE_DAYS * DAY).toISOString()),
    db.prepare(
      "DELETE FROM push_subscription WHERE session_id_hash IS NOT NULL AND session_id_hash NOT IN (SELECT id_hash FROM session)",
    ),
    db
      .prepare("DELETE FROM webauthn_challenge WHERE expires_at < ?")
      .bind(new Date(now).toISOString()),
  ]);
