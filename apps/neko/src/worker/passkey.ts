import {
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { Context } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { androidOrigins } from "./android.ts";
import { allowedEmails } from "./auth.ts";
import type { AppEnv } from "./env.ts";
import { b64url, fromB64url, hashToken, randomToken } from "./token.ts";

const CHALLENGE_COOKIE = "neko_webauthn";
const CHALLENGE_SECONDS = 300;

/**
 * The relying party is the host Neko is served from; the origin must match it exactly, or be the
 * Android app signed with a certificate this site vouches for in assetlinks.json.
 */
const relyingParty = (c: Context<AppEnv>) => {
  const url = new URL(c.req.url);
  return { rpID: url.hostname, origin: [url.origin, ...androidOrigins(c.env)] };
};

/**
 * Keeps the challenge on the server and names it in a signed cookie. The row, not the cookie, is
 * what makes it single-use: a copied cookie cannot replay a challenge already spent.
 */
const rememberChallenge = async (c: Context<AppEnv>, challenge: string) => {
  const id = randomToken();
  await c.env.DB.prepare(
    "INSERT INTO webauthn_challenge (id, challenge, expires_at) VALUES (?, ?, ?)",
  )
    .bind(id, challenge, new Date(Date.now() + CHALLENGE_SECONDS * 1000).toISOString())
    .run();
  await setSignedCookie(c, CHALLENGE_COOKIE, id, c.env.SESSION_SECRET, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/api/passkey",
    maxAge: CHALLENGE_SECONDS,
  });
};

/** Takes the pending challenge out of the database, so each one is used once. */
export const takeChallenge = async (c: Context<AppEnv>) => {
  const id = await getSignedCookie(c, c.env.SESSION_SECRET, CHALLENGE_COOKIE);
  deleteCookie(c, CHALLENGE_COOKIE, { path: "/api/passkey", secure: true });
  if (!id) return null;
  const row = await c.env.DB.prepare(
    "DELETE FROM webauthn_challenge WHERE id = ? AND expires_at > ? RETURNING challenge",
  )
    .bind(id, new Date().toISOString())
    .first<{ challenge: string }>();
  return row?.challenge ?? null;
};

interface InviteRow {
  email: string;
  expires_at: string;
  used_at: string | null;
}

/** The invite's email when the token is known, unused, unexpired and still on the allowlist. */
export const usableInvite = async (c: Context<AppEnv>, token: string) => {
  const row = await c.env.DB.prepare(
    "SELECT email, expires_at, used_at FROM passkey_invite WHERE token_hash = ?",
  )
    .bind(await hashToken(token))
    .first<InviteRow>();
  if (!row || row.used_at || Date.parse(row.expires_at) < Date.now()) return null;
  return allowedEmails(c.env).includes(row.email) ? row.email : null;
};

/** Marks the invite used; false when another request already did. */
export const claimInvite = async (db: D1Database, tokenHash: string, now: string) => {
  const r = await db
    .prepare("UPDATE passkey_invite SET used_at = ? WHERE token_hash = ? AND used_at IS NULL")
    .bind(now, tokenHash)
    .run();
  return r.meta.changes === 1;
};

export const registrationOptions = async (c: Context<AppEnv>, email: string) => {
  const { rpID } = relyingParty(c);
  const options = await generateRegistrationOptions({
    rpName: "Neko",
    rpID,
    userName: email,
    // An opaque, stable handle: the WebAuthn spec says not to put the email in it.
    userID: new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email))),
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
  await rememberChallenge(c, options.challenge);
  return options;
};

export const verifyRegistration = async (
  c: Context<AppEnv>,
  token: string,
  response: RegistrationResponseJSON,
) => {
  const email = await usableInvite(c, token);
  const challenge = await takeChallenge(c);
  if (!email || !challenge) return null;
  const { rpID, origin } = relyingParty(c);
  const result = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  }).catch(() => null);
  if (!result?.verified) return null;
  const { credential } = result.registrationInfo;
  const now = new Date().toISOString();
  // Claiming the invite only if still unused keeps the link single-use even when two requests
  // race: just one of them changes the row.
  if (!(await claimInvite(c.env.DB, await hashToken(token), now))) return null;
  await c.env.DB.prepare(
    "INSERT INTO passkey (id, email, public_key, counter, transports, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(
      credential.id,
      email,
      b64url(credential.publicKey),
      credential.counter,
      JSON.stringify(credential.transports ?? []),
      now,
    )
    .run();
  return email;
};

export const authenticationOptions = async (c: Context<AppEnv>) => {
  const { rpID } = relyingParty(c);
  // No allowCredentials: the phone offers the passkeys it holds for this site.
  const options = await generateAuthenticationOptions({ rpID, userVerification: "preferred" });
  await rememberChallenge(c, options.challenge);
  return options;
};

interface PasskeyRow {
  id: string;
  email: string;
  public_key: string;
  counter: number;
  transports: string;
}

export const verifyAuthentication = async (
  c: Context<AppEnv>,
  response: AuthenticationResponseJSON,
) => {
  const challenge = await takeChallenge(c);
  if (!challenge) return null;
  const row = await c.env.DB.prepare(
    "SELECT id, email, public_key, counter, transports FROM passkey WHERE id = ?",
  )
    .bind(response.id)
    .first<PasskeyRow>();
  if (!row || !allowedEmails(c.env).includes(row.email)) return null;
  const { rpID, origin } = relyingParty(c);
  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: row.id,
      publicKey: fromB64url(row.public_key),
      counter: row.counter,
      transports: JSON.parse(row.transports) as AuthenticatorTransport[],
    },
  }).catch(() => null);
  if (!result?.verified) return null;
  await c.env.DB.prepare("UPDATE passkey SET counter = ?, last_used_at = ? WHERE id = ?")
    .bind(result.authenticationInfo.newCounter, new Date().toISOString(), row.id)
    .run();
  return row.email;
};
