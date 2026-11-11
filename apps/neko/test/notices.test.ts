import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LocalDate } from "@neko/engine";
import { describe, expect, it } from "vitest";
import type { ProjectionResponse } from "../src/shared/types.ts";
import type { Env } from "../src/worker/env.ts";
import {
  ceilingNews,
  ceilingStep,
  clearNotices,
  DEFAULT_EVENING,
  eveningJob,
  loadEveningHour,
  pruneNotices,
  raiseNotice,
  recentNotices,
  remindersView,
  saveEveningHour,
} from "../src/worker/notices.ts";
import { readFailedMessage } from "../src/worker/push.ts";
import { sqliteD1 } from "./d1.ts";

const day = (d: string) => d as LocalDate;
const db = () => sqliteD1() as unknown as D1Database;
// No VAPID keys: the browser push is skipped, the phone's copy is what is under test.
const envWith = (d: D1Database) => ({ DB: d }) as unknown as Env;
const alert = readFailedMessage(new Error("network"));

describe("notices for the phone", () => {
  it("keeps one alert of each kind per day, and takes it down when the problem is solved", async () => {
    const d = db();
    const env = envWith(d);
    const now = new Date("2026-11-11T11:00:00Z");
    await raiseNotice(env, "planilha", day("2026-11-11"), alert, now);
    await raiseNotice(env, "planilha", day("2026-11-11"), alert, new Date("2026-11-12T00:00:00Z"));
    await raiseNotice(env, "meu-pluggy", day("2026-11-11"), { ...alert, title: "Entre" }, now);
    const ids = async () => (await recentNotices(d, now)).map((n) => n.id);
    expect(await ids()).toEqual(["meu-pluggy:2026-11-11", "planilha:2026-11-11"]);
    expect((await recentNotices(d, now))[1]).toEqual({
      id: "planilha:2026-11-11",
      title: alert.title,
      body: alert.body,
      url: "/",
      tag: "alert",
    });
    await clearNotices(d, "planilha");
    expect(await ids()).toEqual(["meu-pluggy:2026-11-11"]);
  });

  it("forgets alerts after a week", async () => {
    const d = db();
    await raiseNotice(
      envWith(d),
      "meu-pluggy",
      day("2026-11-01"),
      alert,
      new Date("2026-11-01T09:00:00Z"),
    );
    await raiseNotice(
      envWith(d),
      "planilha",
      day("2026-11-10"),
      alert,
      new Date("2026-11-10T11:00:00Z"),
    );
    const now = new Date("2026-11-11T11:00:00Z");
    expect((await recentNotices(d, now)).map((n) => n.id)).toEqual(["planilha:2026-11-10"]);
    await pruneNotices(d, now);
    const rows = await d.prepare("SELECT id FROM notice").all<{ id: string }>();
    expect(rows.results.map((r) => r.id)).toEqual(["planilha:2026-11-10"]);
  });
});

describe("the ceiling's news", () => {
  it("is 75% or 100% crossed since the last time, once in a month", () => {
    const tue = day("2026-11-10");
    expect(ceilingStep(null, tue, 50)).toEqual({ news: null, next: null });
    expect(ceilingStep(null, tue, 75)).toEqual({
      news: 75,
      next: { month: "2026-11", mark: 75, day: tue },
    });
    const said = { month: "2026-11", mark: 75, day: tue };
    // The phone and the browser both ask that morning: both hear it, nothing new to keep.
    expect(ceilingStep(said, tue, 75)).toEqual({ news: 75, next: null });
    expect(ceilingStep(said, day("2026-11-11"), 75)).toEqual({ news: null, next: null });
    expect(ceilingStep(said, day("2026-11-12"), 100)).toEqual({
      news: 100,
      next: { month: "2026-11", mark: 100, day: "2026-11-12" },
    });
    // A refund that brings it under 75% and back does not say it again.
    expect(ceilingStep({ ...said, mark: 100 }, day("2026-11-20"), 75).news).toBeNull();
    // A new month starts from zero.
    expect(ceilingStep({ ...said, mark: 100 }, day("2026-12-03"), 75).news).toBe(75);
  });

  it("is kept in D1 between mornings", async () => {
    const d = db();
    const data = (today: string, used: number, mode = "cards") =>
      ({ projection: { today, canSpend: { mode, used } } }) as unknown as ProjectionResponse;
    expect(await ceilingNews(d, data("2026-11-10", 75))).toBe(75);
    expect(await ceilingNews(d, data("2026-11-10", 75))).toBe(75);
    expect(await ceilingNews(d, data("2026-11-11", 75))).toBeNull();
    expect(await ceilingNews(d, data("2026-11-11", 100, "cycle"))).toBeNull();
    expect(await ceilingNews(d, data("2026-11-12", 100))).toBe(100);
  });
});

describe("the evening hour", () => {
  it("is 21:00 until the owner picks another, and only one Ajustes offers", async () => {
    const d = db();
    expect(await loadEveningHour(d)).toBe(DEFAULT_EVENING);
    await saveEveningHour(d, 22);
    expect(await loadEveningHour(d)).toBe(22);
    await d.prepare("UPDATE setting SET value = ? WHERE key = 'evening_hour'").bind("3").run();
    expect(await loadEveningHour(d)).toBe(21);
  });

  it("reads the banks half an hour before the message, and does nothing at other runs", () => {
    expect(eveningJob({ hour: 20, minute: 30 }, 21)).toBe("banks");
    expect(eveningJob({ hour: 21, minute: 0 }, 21)).toBe("message");
    expect(eveningJob({ hour: 21, minute: 30 }, 21)).toBeNull();
    expect(eveningJob({ hour: 22, minute: 0 }, 21)).toBeNull();
    expect(eveningJob({ hour: 22, minute: 30 }, 23)).toBe("banks");
  });
});

describe("GET /api/reminders", () => {
  it("hands the phone both messages, its evening hour and the alerts", () => {
    const data = {
      projection: { today: "2026-11-10", todayLogged: true, upcoming: [], insights: [] },
      sheet: { id: "s", tabs: {} },
    } as unknown as ProjectionResponse;
    const notices = [{ id: "planilha:2026-11-10", ...alert }];
    expect(remindersView(data, { ceiling: null, eveningHour: 22, notices })).toEqual({
      morning: null,
      evening: null,
      eveningHour: 22,
      notices,
    });
  });
});

describe("reminders.json", () => {
  /** The Android app parses this file in its unit tests. UPDATE_CONTRACT=1 rewrites it. */
  it("matches what the Worker sends the phone", () => {
    const data = {
      projection: {
        today: "2026-11-10",
        todayRef: { tab: "2026", a1: "BB17" },
        upcoming: [
          { date: "2026-11-10", description: "Aluguel", amount: 1484_24, kind: "bill" },
          { date: "2026-11-10", description: "Roxo", amount: 154_00, kind: "card" },
        ],
        insights: [],
      },
      sheet: { id: "s", tabs: { "2026": 1 } },
      writing: true,
      bank: { queue: [{ key: "a", kind: "diario", date: "2026-11-10", title: "PADARIA" }] },
      habit: { editedToday: false, streak: 6, atRisk: false },
    } as unknown as ProjectionResponse;
    const view = remindersView(data, {
      ceiling: null,
      eveningHour: 22,
      notices: [{ id: "meu-pluggy:2026-11-10", ...alert, title: "Entre no Meu Pluggy de novo" }],
    });
    const path = join(import.meta.dirname, "../../android/app/src/test/resources/reminders.json");
    if (process.env.UPDATE_CONTRACT) writeFileSync(path, `${JSON.stringify(view, null, 2)}\n`);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(view);
  });
});
