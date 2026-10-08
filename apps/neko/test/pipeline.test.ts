import { localDate } from "@neko/engine";
import { describe, expect, it } from "vitest";
import type { ProjectionResponse } from "../src/shared/types.ts";
import { checkedAt, loadHabit, monthEndHistory, recordEdits } from "../src/worker/pipeline.ts";
import { sqliteD1 } from "./d1.ts";

describe("checkedAt", () => {
  it("dates a cached projection by the check that confirmed it, keeping everything else", () => {
    const cached = {
      projection: { today: "2026-10-05" },
      sheet: {
        id: "s",
        version: "7",
        modifiedTime: "2026-10-04T20:00:00.000Z",
        readAt: "2026-10-05T04:34:00.000Z",
        tabs: {},
      },
    } as unknown as ProjectionResponse;
    const r = checkedAt(cached, new Date("2026-10-05T10:30:00.000Z"));
    expect(r.sheet.readAt).toBe("2026-10-05T10:30:00.000Z");
    expect(r.sheet.modifiedTime).toBe("2026-10-04T20:00:00.000Z");
    expect(r.projection).toBe(cached.projection);
    expect(cached.sheet.readAt).toBe("2026-10-05T04:34:00.000Z");
  });
});

describe("monthEndHistory", () => {
  it("leaves out readings from before the month end came only from the sheet", async () => {
    const db = sqliteD1();
    const insert = (hash: string, today: string, end: number) =>
      db.sqlite
        .prepare(
          "INSERT INTO snapshot (file_version, today, settings_hash, month_end_projected, projection) VALUES ('1', ?, ?, ?, '{}')",
        )
        .run(today, hash, end);
    insert("28:abc", "2026-10-01", 900_00);
    insert("29:abc", "2026-10-02", 1000_00);
    insert("30:abc", "2026-10-05", 1150_00);
    const points = await monthEndHistory(db as unknown as D1Database, localDate("2026-10-05"));
    expect(points.map((p) => p.monthEndProjected)).toEqual([1000_00, 1150_00]);
  });
});

describe("sheet edits", () => {
  it("turns the edits Neko saw into São Paulo days, once per instant", async () => {
    const db = sqliteD1() as unknown as D1Database;
    await recordEdits(db, ["2026-10-06T20:00:00.000Z", "2026-10-08T01:30:00.000Z"]);
    await recordEdits(db, ["2026-10-08T01:30:00.000Z", "2026-10-08T12:00:00.000Z"]);
    const h = await loadHabit(db, localDate("2026-10-08"));
    // 01:30 UTC on the 8th is still the 7th in São Paulo.
    expect(h.streak).toBe(3);
    expect(h.editedToday).toBe(true);
  });
  it("starts from the edits the cached projections already saw", async () => {
    const db = sqliteD1();
    db.sqlite
      .prepare(
        "INSERT INTO snapshot (file_version, today, settings_hash, projection) VALUES ('1', '2026-10-07', 'x', ?)",
      )
      .run(JSON.stringify({ sheet: { modifiedTime: "2026-10-07T10:00:00.000Z" } }));
    const d1 = db as unknown as D1Database;
    await recordEdits(d1, ["2026-10-08T12:00:00.000Z"]);
    const h = await loadHabit(d1, localDate("2026-10-08"));
    expect(h.streak).toBe(2);
    expect(h.since).toBe("2026-10-07");
  });
});
