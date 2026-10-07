import { describe, expect, it } from "vitest";
import {
  addDays,
  cents,
  localDate,
  project,
  type SaveDay,
  type Settings,
  saveable,
} from "../src/index.ts";
import { cell, item, ledger } from "./builders.ts";

/** `n` days from 2026-10-05 at `balance`, with the given incomes and balance overrides. */
const days = (
  n: number,
  balance: number,
  over: Record<number, { balance?: number; income?: number }> = {},
): SaveDay[] =>
  Array.from({ length: n }, (_, i) => ({
    date: addDays(localDate("2026-10-05"), i),
    balance: cents(over[i]?.balance ?? balance),
    income: cents(over[i]?.income ?? 0),
  }));

describe("saveable", () => {
  it("saves on the payday what keeps the lowest balance ahead at the cushion, in R$ 50 steps", () => {
    const s = saveable(
      days(60, 3_000_00, {
        15: { income: 5_000_00, balance: 8_000_00 },
        40: { balance: 2_830_00 },
      }),
    );
    expect(s).toEqual({
      date: "2026-10-20",
      income: 5_000_00,
      amount: 2_300_00,
      lowest: 2_830_00,
      lowestDate: "2026-11-14",
      leftAtLowest: 530_00,
      until: "2026-12-03",
    });
  });

  it("ignores the days before the payday: money spent before it is not affected", () => {
    const s = saveable(days(60, 3_000_00, { 2: { balance: 100_00 }, 10: { income: 4_000_00 } }));
    expect(s?.date).toBe("2026-10-15");
    expect(s?.amount).toBe(2_500_00);
  });

  it("picks the biggest income in the next 35 days, not a small refund", () => {
    const s = saveable(
      days(60, 3_000_00, {
        3: { income: 50_00 },
        20: { income: 6_000_00 },
        50: { income: 9_000_00 },
      }),
    );
    expect(s?.date).toBe("2026-10-25");
  });

  it("stays quiet without an income ahead, a short horizon, or little room", () => {
    expect(saveable(days(60, 3_000_00))).toBeNull();
    expect(saveable(days(25, 3_000_00, { 0: { income: 1_000_00 } }))).toBeNull();
    expect(saveable(days(60, 580_00, { 0: { income: 1_000_00 } }))).toBeNull();
  });
});

describe("project → saving", () => {
  it("reads the payday and balances from the ledger", () => {
    const settings: Settings = {
      dailyForecast: cents(0),
      usualCard: null,
      cycleBudget: null,
      cards: [],
      othersCards: [],
    };
    const l = ledger("2026-10-01", 92, 2_000_00, {
      "2026-10-20": { entrada: cell(3_000_00, [item(3_000_00, "Salário")]) },
    });
    const p = project(l, localDate("2026-10-05"), settings);
    expect(p.saving?.date).toBe("2026-10-20");
    expect(p.saving?.income).toBe(3_000_00);
  });
});
