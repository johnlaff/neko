import { describe, expect, it } from "vitest";
import {
  addDays,
  clampedDay,
  clockIn,
  diffDays,
  localDate,
  todayIn,
  weekday,
  weekStart,
} from "../src/index.ts";

describe("dates", () => {
  it("rejects impossible dates", () => {
    expect(() => localDate("2026-02-30")).toThrow();
    expect(localDate("2028-02-29")).toBe("2028-02-29");
  });
  it("adds and diffs across month and year boundaries", () => {
    expect(addDays(localDate("2026-12-31"), 1)).toBe("2027-01-01");
    expect(diffDays(localDate("2026-02-27"), localDate("2026-03-01"))).toBe(2);
  });
  it("clamps the day and normalizes month overflow", () => {
    expect(clampedDay(2026, 2, 31)).toBe("2026-02-28");
    expect(clampedDay(2026, 0, 15)).toBe("2025-12-15");
    expect(clampedDay(2026, 13, 31)).toBe("2027-01-31");
  });
  it("uses São Paulo's civil date, not UTC", () => {
    expect(todayIn(new Date("2026-10-05T02:30:00Z"))).toBe("2026-10-04");
  });
  it("reads São Paulo's clock, midnight as hour 0", () => {
    expect(clockIn(new Date("2026-10-05T02:30:00Z"))).toEqual({ hour: 23, minute: 30 });
    expect(clockIn(new Date("2026-10-05T03:00:00Z"))).toEqual({ hour: 0, minute: 0 });
    expect(clockIn(new Date("2026-10-05T11:05:00Z"))).toEqual({ hour: 8, minute: 5 });
  });
  it("starts weeks on Sunday, as the streak does", () => {
    expect(weekday(localDate("2026-11-15"))).toBe(0);
    expect(weekStart(localDate("2026-11-15"))).toBe("2026-11-15");
    expect(weekStart(localDate("2026-11-21"))).toBe("2026-11-15");
    expect(weekStart(localDate("2026-11-01"))).toBe("2026-11-01");
  });
});
