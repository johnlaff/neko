import { describe, expect, it } from "vitest";
import { IDLE_DAYS, pruneSessions } from "../src/worker/auth.ts";
import type { Env } from "../src/worker/env.ts";
import worker from "../src/worker/index.ts";
import { claimInvite } from "../src/worker/passkey.ts";
import { liveSubscriptions } from "../src/worker/push.ts";
import { sqliteD1 } from "./d1.ts";

const DAY = 86_400_000;
const NOW = new Date("2026-10-05T12:00:00Z");
const at = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();

const withSession = (
  db: ReturnType<typeof sqliteD1>,
  id: string,
  lastSeen: number,
  expires: number,
) =>
  db.sqlite
    .prepare(
      "INSERT INTO session (id_hash, email, device, created_at, last_seen_at, expires_at) VALUES (?, 'dono@example.com', 'iPhone', ?, ?, ?)",
    )
    .run(id, at(-40), at(lastSeen), at(expires));

const withSubscription = (
  db: ReturnType<typeof sqliteD1>,
  endpoint: string,
  session: string | null,
) =>
  db.sqlite
    .prepare(
      "INSERT INTO push_subscription (endpoint, p256dh, auth, created_at, session_id_hash) VALUES (?, 'k', 'a', ?, ?)",
    )
    .run(endpoint, at(-1), session);

describe("signing a device out also stops its reminders", () => {
  it("sends only to devices still signed in, and to subscriptions saved before sessions", async () => {
    const db = sqliteD1();
    withSession(db, "live", -1, 60);
    withSession(db, "idle", -(IDLE_DAYS + 1), 60);
    withSession(db, "ended", -1, -1);
    withSubscription(db, "https://push/live", "live");
    withSubscription(db, "https://push/idle", "idle");
    withSubscription(db, "https://push/ended", "ended");
    withSubscription(db, "https://push/signed-out", "gone");
    withSubscription(db, "https://push/legacy", null);
    const sent = await liveSubscriptions(db as unknown as D1Database, NOW);
    expect(sent.map((s) => s.endpoint).sort()).toEqual([
      "https://push/legacy",
      "https://push/live",
    ]);
  });

  it("prunes the subscriptions of devices no longer signed in and stale challenges", async () => {
    const db = sqliteD1();
    withSession(db, "live", -1, 60);
    withSession(db, "ended", -1, -1);
    withSubscription(db, "https://push/live", "live");
    withSubscription(db, "https://push/ended", "ended");
    withSubscription(db, "https://push/legacy", null);
    db.sqlite
      .prepare(
        "INSERT INTO webauthn_challenge (id, challenge, expires_at) VALUES ('old', 'c', ?), ('new', 'c', ?)",
      )
      .run(at(-1), at(1));
    await pruneSessions(db as unknown as D1Database, NOW.getTime());
    const left = db.sqlite
      .prepare("SELECT endpoint FROM push_subscription ORDER BY endpoint")
      .all();
    expect(left.map((r) => r.endpoint)).toEqual(["https://push/legacy", "https://push/live"]);
    const challenges = db.sqlite.prepare("SELECT id FROM webauthn_challenge").all();
    expect(challenges.map((r) => r.id)).toEqual(["new"]);
  });
});

describe("one-time links and challenges", () => {
  it("lets only one of two racing registrations claim an invite", async () => {
    const db = sqliteD1();
    db.sqlite
      .prepare(
        "INSERT INTO passkey_invite (token_hash, email, expires_at) VALUES ('h', 'dono@example.com', ?)",
      )
      .run(at(1));
    const d1 = db as unknown as D1Database;
    expect(await claimInvite(d1, "h", at(0))).toBe(true);
    expect(await claimInvite(d1, "h", at(0))).toBe(false);
  });

  it("keeps the challenge on the server and spends it on the first answer", async () => {
    const db = sqliteD1();
    const env = {
      ALLOWED_EMAILS: "dono@example.com",
      SESSION_SECRET: "test-secret",
      DB: db,
    } as unknown as Env;
    const post = (path: string, body: unknown, cookie?: string) =>
      worker.fetch(
        new Request(`https://neko.test/api/passkey/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
          body: JSON.stringify(body),
        }) as never,
        env,
        {} as ExecutionContext,
      );
    const options = await post("login/options", {});
    const { challenge } = (await options.json()) as { challenge: string };
    const cookie = (options.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    // The cookie names the row; the challenge itself is not in it.
    expect(cookie).not.toContain(challenge);
    expect(db.sqlite.prepare("SELECT challenge FROM webauthn_challenge").all()).toEqual([
      { challenge },
    ]);
    const credential = { id: "abc", rawId: "abc", type: "public-key", response: {} };
    expect((await post("login/verify", { response: credential }, cookie)).status).toBe(403);
    expect(db.sqlite.prepare("SELECT id FROM webauthn_challenge").all()).toEqual([]);
  });
});
