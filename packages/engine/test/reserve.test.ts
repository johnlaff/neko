import { describe, expect, it } from "vitest";
import {
  type Cents,
  cents,
  type Reserve,
  type ReserveMonth,
  reserve,
  reserveSteps,
  savingStep,
  yearTotals,
} from "../src/index.ts";

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
  savedToDate: c(saved),
  entradaToDate: c(entrada),
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

  it("leaves out lines later this month: a planned deposit is not kept yet", () => {
    const october = { ...month(2026, 10, 2000_00, 800_00), savedToDate: c(500_00) };
    const r = reserve([month(2026, 9, 2000_00, 1000_00), october], today);
    expect(r?.kept).toBe(1500_00);
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

  it("counts only what is dated up to today, income included", () => {
    const t = yearTotals(
      [
        month(2026, 9, 1000_00, 500_00, 10000_00),
        { ...month(2026, 10, 1000_00, 800_00, 10000_00), savedToDate: c(0), entradaToDate: c(0) },
        { ...month(2026, 11, 1000_00, 800_00), savedToDate: c(0), entradaToDate: c(0) },
      ],
      2026,
    );
    expect(t).toEqual({ year: 2026, entrada: 10000_00, saved: 500_00, savedShare: 5 });
  });

  it("has no share without income", () => {
    expect(yearTotals([], 2026).savedShare).toBeNull();
  });
});

describe("reserveSteps", () => {
  const kept = (cost: number, saved: number): Reserve => ({
    cost: c(cost),
    costMonths: 3,
    min: c(cost * 6),
    max: c(cost * 12),
    kept: c(saved),
    coveredTenths: Math.floor((saved * 10) / cost),
  });

  it("starts with a step near enough for one payday, then 1, 3, 6 and 12 months of cost", () => {
    const s = reserveSteps(kept(6000_00, 0));
    expect(s.steps).toEqual([
      { amount: 3000_00, months: null },
      { amount: 6000_00, months: 1 },
      { amount: 18000_00, months: 3 },
      { amount: 36000_00, months: 6 },
      { amount: 72000_00, months: 12 },
    ]);
    expect(s).toMatchObject({
      reached: 0,
      next: { amount: 3000_00, months: null },
      missing: 3000_00,
    });
  });

  it("goes to the next step once one is kept, exactly at its amount too", () => {
    expect(reserveSteps(kept(6000_00, 3400_00))).toMatchObject({
      reached: 1,
      next: { months: 1 },
      missing: 2600_00,
    });
    expect(reserveSteps(kept(6000_00, 6000_00))).toMatchObject({ reached: 2, next: { months: 3 } });
  });

  it("leaves the first step out when one month of cost is already within it", () => {
    const s = reserveSteps(kept(2500_00, 0));
    expect(s.steps.map((x) => x.months)).toEqual([1, 3, 6, 12]);
    expect(s.next).toEqual({ amount: 2500_00, months: 1 });
  });

  it("has no next step past 12 months", () => {
    expect(reserveSteps(kept(4000_00, 50000_00))).toMatchObject({
      reached: 5,
      next: null,
      missing: 0,
    });
  });

  describe("savingStep", () => {
    it("says what is still missing for the next step after saving", () => {
      expect(savingStep(kept(6000_00, 0), c(1800_00))).toEqual({
        step: { amount: 3000_00, months: null },
        index: 1,
        missing: 1200_00,
      });
    });

    it("names the highest step the saving reaches", () => {
      expect(savingStep(kept(6000_00, 1000_00), c(5500_00))).toEqual({
        step: { amount: 6000_00, months: 1 },
        index: 2,
        missing: 0,
      });
    });

    it("has nothing to say past the last step", () => {
      expect(savingStep(kept(4000_00, 50000_00), c(1000_00))).toBeNull();
    });

    it("stops pushing once the method's 6 months are kept, unless it reaches 12", () => {
      expect(savingStep(kept(4000_00, 26000_00), c(1000_00))).toBeNull();
      expect(savingStep(kept(4000_00, 46000_00), c(3000_00))).toEqual({
        step: { amount: 48000_00, months: 12 },
        index: 5,
        missing: 0,
      });
    });

    it("names the 6 months when the saving reaches them", () => {
      expect(savingStep(kept(4000_00, 22000_00), c(3000_00))).toMatchObject({
        step: { months: 6 },
        missing: 0,
      });
    });
  });
});
