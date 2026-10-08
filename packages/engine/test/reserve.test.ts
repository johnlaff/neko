import { describe, expect, it } from "vitest";
import { type Cents, cents, type ReserveMonth, reserve, yearTotals } from "../src/index.ts";

const c = (n: number): Cents => cents(n);
const month = (
  year: number,
  m: number,
  livingCost: number,
  saved = 0,
  entrada = 5000_00,
): ReserveMonth => ({
  year,
  month: m,
  entrada: c(entrada),
  saida: c(livingCost + saved),
  diario: c(0),
  saved: c(saved),
  livingCost: c(livingCost),
});

describe("reserve", () => {
  const today = { year: 2026, month: 10 };

  it("averages the cost of living over the last three closed months", () => {
    const r = reserve(
      [
        month(2026, 6, 9000_00),
        month(2026, 7, 3000_00),
        month(2026, 8, 4000_00),
        month(2026, 9, 5000_00),
        month(2026, 10, 99000_00),
      ],
      today,
    );
    expect(r).toMatchObject({ cost: 4000_00, costMonths: 3, min: 24000_00, max: 48000_00 });
  });

  it("skips months the sheet has no lines for", () => {
    const empty: ReserveMonth = { ...month(2026, 9, 0), entrada: c(0), saida: c(0) };
    const r = reserve([month(2026, 8, 3000_00), empty], today);
    expect(r).toMatchObject({ cost: 3000_00, costMonths: 1 });
  });

  it("counts what was kept up to the current month, not what is planned", () => {
    const r = reserve(
      [
        month(2026, 8, 2000_00, 1000_00),
        month(2026, 9, 2000_00, 500_00),
        month(2026, 10, 2000_00, 500_00),
        month(2026, 11, 2000_00, 9000_00),
      ],
      today,
    );
    expect(r?.kept).toBe(2000_00);
    // R$ 2.000 kept over R$ 2.000 a month: one month covered.
    expect(r?.coveredTenths).toBe(10);
  });

  it("rounds the covered months down to a tenth", () => {
    const r = reserve([month(2026, 9, 3000_00, 5000_00)], today);
    expect(r?.coveredTenths).toBe(16);
  });

  it("has nothing to say before a month has closed", () => {
    expect(reserve([month(2026, 10, 2000_00)], today)).toBeNull();
    expect(reserve([], today)).toBeNull();
  });
});

describe("yearTotals", () => {
  it("sums the year as the Economia tab does", () => {
    const t = yearTotals(
      [
        month(2025, 12, 1000_00, 900_00),
        month(2026, 1, 1000_00, 500_00),
        month(2026, 2, 1000_00, 1000_00, 10000_00),
      ],
      2026,
    );
    expect(t).toEqual({ year: 2026, entrada: 15000_00, saved: 1500_00, savedShare: 10 });
  });

  it("has no share without income", () => {
    expect(yearTotals([], 2026).savedShare).toBeNull();
  });
});
