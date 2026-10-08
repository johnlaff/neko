import { describe, expect, it } from "vitest";
import { cents, localDate, type MonthView, monthRecap } from "../src/index.ts";

const month = (year: number, m: number, livingCost: number, extra: Partial<MonthView> = {}) =>
  ({
    year,
    month: m,
    entrada: cents(5000_00),
    saida: cents(livingCost),
    diario: cents(0),
    sobra: cents(0),
    startBalance: cents(0),
    endSheet: cents(0),
    result: cents(300_00),
    outflows: [
      {
        label: "Aluguel",
        amount: cents(1900_00),
        count: 1,
        kind: "bill",
        change: null,
        countBefore: null,
      },
    ],
    fixed: [],
    fixedTotal: cents(0),
    days: [],
    saved: cents(500_00),
    savedShare: 10,
    livingCost: cents(livingCost),
    ...extra,
  }) as unknown as MonthView;

describe("monthRecap", () => {
  const months = [month(2026, 8, 4000_00), month(2026, 9, 3500_00)];

  it("sums up the closed month in the first days of the next", () => {
    expect(monthRecap(months, localDate("2026-10-03"))).toEqual({
      year: 2026,
      month: 9,
      result: 300_00,
      saved: 500_00,
      savedShare: 10,
      livingCost: 3500_00,
      costChange: -500_00,
      top: { label: "Aluguel", amount: 1900_00 },
    });
  });

  it("goes away after the first week", () => {
    expect(monthRecap(months, localDate("2026-10-07"))).not.toBeNull();
    expect(monthRecap(months, localDate("2026-10-08"))).toBeNull();
  });

  it("crosses the year and skips a month the sheet has no lines for", () => {
    const dec = month(2025, 12, 2000_00);
    expect(monthRecap([dec], localDate("2026-01-02"))?.month).toBe(12);
    expect(monthRecap([dec], localDate("2026-01-02"))?.costChange).toBeNull();
    const empty = month(2026, 9, 0, { entrada: cents(0) });
    expect(monthRecap([empty], localDate("2026-10-02"))).toBeNull();
  });
});
