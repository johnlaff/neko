import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { issueKey, todayView } from "../src/shared/today.ts";
import type { ProjectionResponse } from "../src/shared/types.ts";
import { androidOrigins, assetLinks } from "../src/worker/android.ts";
import type { Env } from "../src/worker/env.ts";
import worker from "../src/worker/index.ts";

const FP =
  "8C:49:14:31:6D:EE:64:6A:62:90:CD:8D:34:39:14:A1:EC:46:AD:CF:EE:A2:F0:22:1B:E8:8E:91:92:0E:D9:C5";

const env = {
  ALLOWED_EMAILS: "dono@example.com",
  SESSION_SECRET: "test-secret",
  ANDROID_PACKAGE: "dev.johnlaff.neko",
  ANDROID_CERT_SHA256: ` ${FP.toLowerCase()} , not-a-fingerprint`,
} as unknown as Env;

const call = (path: string) =>
  worker.fetch(new Request(`https://neko.test${path}`) as never, env, {} as ExecutionContext);

describe("android sign-in", () => {
  it("accepts passkeys from the app signed with a listed certificate, and nothing else", () => {
    // base64url of the certificate's SHA-256, as Credential Manager reports the app's origin.
    expect(androidOrigins(env)).toEqual([
      "android:apk-key-hash:jEkUMW3uZGpikM2NNDkUoexGrc_uovAiG-iOkZIO2cU",
    ]);
    expect(androidOrigins({ ANDROID_CERT_SHA256: "" })).toEqual([]);
  });

  it("publishes assetlinks.json for the app's package and certificate", async () => {
    const res = await call("/.well-known/assetlinks.json");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      {
        relation: [
          "delegate_permission/common.handle_all_urls",
          "delegate_permission/common.get_login_creds",
        ],
        target: {
          namespace: "android_app",
          package_name: "dev.johnlaff.neko",
          sha256_cert_fingerprints: [FP],
        },
      },
    ]);
  });

  it("vouches for no app until both the package and a certificate are set", () => {
    expect(assetLinks({ ANDROID_PACKAGE: "dev.johnlaff.neko", ANDROID_CERT_SHA256: "" })).toEqual(
      [],
    );
  });

  it("keeps Hoje behind a session", async () => {
    expect((await call("/api/today")).status).toBe(401);
  });
});

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "e2e", "projection.json"), "utf8"),
) as ProjectionResponse;

/** The fixture with a few Conferência points: two recent, one older than the 60-day window. */
const withIssues = (): ProjectionResponse => ({
  ...fixture,
  projection: {
    ...fixture.projection,
    health: [
      { kind: "missing-date", date: "2026-07-01", ref: { tab: "2026", a1: "A1" } },
      { kind: "missing-date", date: "2026-09-20", ref: { tab: "2026", a1: "A2" } },
      { kind: "missing-date", date: "2026-10-01", ref: { tab: "2026", a1: "A3" } },
    ] as ProjectionResponse["projection"]["health"],
  },
});

describe("today view", () => {
  it("groups the next days with each day's net, as Hoje shows them", () => {
    const v = todayView(fixture, []);
    expect(v.upcoming.map((d) => [d.date, d.items.length, d.net])).toEqual([
      ["2026-10-05", 1, 5_600_00],
      ["2026-10-10", 3, -(1_900_00 + 188_82 + 120_00)],
    ]);
    expect(v.upcomingCount).toBe(4);
  });

  it("says when the usual card passed its plan", () => {
    const v = todayView(fixture, []);
    expect(v.canSpend).toMatchObject({ card: "Cartão Azul", pace: "over" });
  });

  it("links today's row in the sheet", () => {
    expect(todayView(fixture, []).todayUrl).toBe(
      "https://docs.google.com/spreadsheets/d/planilha-de-exemplo/edit#gid=2&range=A9",
    );
  });

  it("lists the last 60 days of Conferência, newest first, minus the ones already checked", () => {
    const r = withIssues();
    const all = todayView(r, []);
    expect(all.issues.map((i) => i.issue.date)).toEqual(["2026-10-01", "2026-09-20"]);
    expect(all.issues[0]?.url).toContain("range=A3");
    expect(all.issuesInWindow).toBe(2);

    const checked = todayView(r, [issueKey(r.projection.health[2] as never)]);
    expect(checked.issues.map((i) => i.issue.date)).toEqual(["2026-09-20"]);
    expect(checked.issuesInWindow).toBe(2);
  });

  it("shows the payday saving only in the days just before it", () => {
    expect(todayView(fixture, []).saving?.date).toBe("2026-10-05");
    const later = {
      ...fixture,
      projection: {
        ...fixture.projection,
        saving: { ...(fixture.projection.saving as object), date: "2026-10-20" },
      },
    } as ProjectionResponse;
    expect(todayView(later, []).saving).toBeNull();
  });
});

/**
 * The Android app parses this file in its unit tests (TodayViewTest), so the two sides agree on
 * field names. UPDATE_CONTRACT=1 rewrites it after an intended change to the view.
 */
describe("android contract", () => {
  it("matches what the Worker sends for the e2e fixture", () => {
    const path = join(import.meta.dirname, "../../android/app/src/test/resources/today.json");
    const view = todayView(fixture, []);
    if (process.env.UPDATE_CONTRACT) writeFileSync(path, `${JSON.stringify(view, null, 2)}\n`);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(view);
  });
});
