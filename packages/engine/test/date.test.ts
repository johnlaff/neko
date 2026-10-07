import { describe, expect, it } from "vitest";
import { addDays, clampedDay, diffDays, localDate, todayIn } from "../src/index.ts";

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
});
