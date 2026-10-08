import { describe, expect, it } from "vitest";
import {
  type CanSpend,
  cents,
  localDate,
  type MonthView,
  simulateInstallments,
  splitInstallments,
} from "../src/index.ts";

const month = (y: number, m: number, end: number) =>
  ({ year: y, month: m, endSheet: cents(end) }) as MonthView;

// Usual card bill due Nov 10, R$ 3.000 plan, R$ 1.000 on it, 10 days left in the cycle.
const cs = {
  card: "Visa",
  budget: cents(3_000_00),
  accumulated: cents(1_000_00),
  daysLeft: 10,
  perDay: cents(200_00),
  due: localDate("2026-11-10"),
} as CanSpend;

const months = [
  month(2026, 10, 5_000_00),
  month(2026, 11, 3_000_00),
  month(2026, 12, 2_500_00),
  month(2027, 1, 2_000_00),
];

describe("installments", () => {
  it("splits into equal parcels with the leftover cents on the first", () => {
    expect(splitInstallments(cents(1_000_00), 3)).toEqual([333_34, 333_33, 333_33]);
    expect(splitInstallments(cents(90_00), 1)).toEqual([90_00]);
  });

  it("refuses a parcel count outside 1 to 24", () => {
    expect(() => splitInstallments(cents(100_00), 0)).toThrow(RangeError);
    expect(() => splitInstallments(cents(100_00), 25)).toThrow(RangeError);
    expect(() => splitInstallments(cents(100_00), 1.5)).toThrow(RangeError);
  });

  it("puts only the first parcel on the open bill, one bill per month after it", () => {
    const s = simulateInstallments(cs, months, cents(1_200_00), 3);
    expect(s.cycle).toEqual({ perDay: 160_00, remaining: 1_600_00, due: "2026-11-10" });
    expect(s.parcels).toEqual([
      { due: "2026-11-10", amount: 400_00 },
      { due: "2026-12-10", amount: 400_00 },
      { due: "2027-01-10", amount: 400_00 },
    ]);
  });

  it("lowers every month end from the first parcel on, by what is due so far", () => {
    const s = simulateInstallments(cs, months, cents(1_200_00), 3);
    expect(s.months.map((m) => [m.month, m.endBefore, m.endAfter])).toEqual([
      [11, 3_000_00, 2_600_00],
      [12, 2_500_00, 1_700_00],
      [1, 2_000_00, 800_00],
    ]);
    expect(s.lowest).toEqual({ year: 2027, month: 1, end: 800_00, date: null });
    expect(s.firstNegative).toBeNull();
  });

  it("names the first month the purchase pushes into the red", () => {
    const s = simulateInstallments(cs, months, cents(6_000_00), 2);
    expect(s.firstNegative).toEqual({ year: 2026, month: 12, end: -3_500_00, date: null });
  });

  it("checks every day, not just month ends: a dip mid-month counts", () => {
    const day = (d: number, balance: number) => ({ day: d, balance: cents(balance) });
    const withDays = [
      // Nov: R$ 300 on the 9th, R$ 900 from the 10th; the month ends at R$ 3.000 after salary.
      { ...month(2026, 11, 3_000_00), days: [day(9, 300_00), day(10, 900_00), day(30, 3_000_00)] },
    ] as unknown as MonthView[];
    const s = simulateInstallments(cs, withDays, cents(1_000_00), 1);
    // The parcel leaves on the 10th: the 9th is untouched, the 10th goes to −R$ 100.
    expect(s.firstNegative).toEqual({ year: 2026, month: 11, end: -100_00, date: "2026-11-10" });
    expect(s.lowest).toEqual({ year: 2026, month: 11, end: -100_00, date: "2026-11-10" });
  });

  it("keeps the due day valid in shorter months", () => {
    const late = { ...cs, due: localDate("2026-01-31") };
    const s = simulateInstallments(late, [], cents(300_00), 2);
    expect(s.parcels.map((p) => p.due)).toEqual(["2026-01-31", "2026-02-28"]);
  });
});
