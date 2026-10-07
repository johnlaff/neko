import { localDate } from "@neko/engine";
import { describe, expect, it } from "vitest";
import type { ProjectionResponse } from "../src/shared/types.ts";
import { checkedAt, monthEndHistory } from "../src/worker/pipeline.ts";
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
