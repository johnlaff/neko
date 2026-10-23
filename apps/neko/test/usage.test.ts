import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { USAGE } from "../src/shared/usage.ts";
import type { Env } from "../src/worker/env.ts";
import { recordUse, usageSummary } from "../src/worker/usage.ts";
import { sqliteD1 } from "./d1.ts";

const db = () => sqliteD1() as unknown as D1Database;

describe("usage", () => {
  it("counts each screen and button per day and app, and sums the last 30 days", async () => {
    const d = db();
    await recordUse(d, "2026-10-20", "hoje", "android");
    await recordUse(d, "2026-10-20", "hoje", "android");
    await recordUse(d, "2026-10-21", "hoje", "web");
    await recordUse(d, "2026-10-21", "simular", "android");
    // Older than 30 days: kept in D1, out of the summary.
    await recordUse(d, "2026-09-01", "mia", "android");
    const s = await usageSummary(d, "2026-10-23");
    expect(s).toMatchObject({ window: 30, days: 2, android: 2, web: 1 });
    const count = (event: string) => s.events.find((e) => e.event === event)?.count;
    expect(count("hoje")).toBe(3);
    expect(count("simular")).toBe(1);
    // What was never used is the most telling line: it is listed, with zero.
    expect(count("mia")).toBe(0);
    expect(s.events.map((e) => e.event)).toEqual(Object.keys(USAGE));
    expect(s.events[0]).toEqual({ event: "hoje", label: "Hoje", count: 3 });
  });

  it("says nothing was used before the first count", async () => {
    expect(await usageSummary(db(), "2026-10-23")).toMatchObject({ days: 0, android: 0, web: 0 });
  });

  /** The Android app parses this file in its unit tests. UPDATE_CONTRACT=1 rewrites it. */
  it("usage.json matches what the Worker sends", async () => {
    const d = db();
    await recordUse(d, "2026-10-22", "hoje", "android");
    await recordUse(d, "2026-10-23", "faturas", "web");
    const summary = await usageSummary(d, "2026-10-23");
    const path = join(import.meta.dirname, "../../android/app/src/test/resources/usage.json");
    if (process.env.UPDATE_CONTRACT) writeFileSync(path, `${JSON.stringify(summary, null, 2)}\n`);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(summary);
  });
});

describe("usage api", () => {
  const env = {
    ALLOWED_EMAILS: "dono@example.com",
    SESSION_SECRET: "test-secret",
  } as unknown as Env;
  it("takes counts and gives the summary only to a signed-in device", async () => {
    const worker = (await import("../src/worker/index.ts")).default;
    const call = (init?: RequestInit) =>
      worker.fetch(
        new Request("https://neko.test/api/usage", init) as never,
        env,
        {} as ExecutionContext,
      );
    expect((await call()).status).toBe(401);
    const post = await call({
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://neko.test" },
      body: JSON.stringify({ event: "hoje", app: "web" }),
    });
    expect(post.status).toBe(401);
  });
});
