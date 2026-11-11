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
  const settings: Settings = {
    dailyForecast: cents(0),
    usualCard: null,
    cycleBudget: null,
    cards: [],
    othersCards: [],
  };
  it("reads the payday and balances from the ledger", () => {
    const l = ledger("2026-10-01", 92, 2_000_00, {
      "2026-10-20": { entrada: cell(3_000_00, [item(3_000_00, "Salário")]) },
      "2026-11-15": { diario: cell(100_00) },
      "2026-12-15": { diario: cell(100_00) },
    });
    const p = project(l, localDate("2026-10-05"), settings);
    expect(p.saving?.date).toBe("2026-10-20");
    expect(p.saving?.income).toBe(3_000_00);
  });

  it("does not count on months ahead that have no spending on the sheet yet", () => {
    const l = ledger("2026-10-01", 92, 2_000_00, {
      "2026-10-20": { entrada: cell(3_000_00, [item(3_000_00, "Salário")]) },
      "2026-12-15": { diario: cell(100_00) },
    });
    // November has neither diário nor a card bill: its balances would make the saving too big.
    expect(project(l, localDate("2026-10-05"), settings).saving).toBeNull();
  });

  const itau = { name: "Itau", dueDay: 10, closingDay: 3, closingEstimated: false };
  const gio = { name: "Gio", dueDay: 12, closingDay: 5, closingEstimated: false };

  it("keeps back what the ceiling still lets the bills ahead take", () => {
    const l = ledger("2026-10-01", 92, 2_000_00, {
      "2026-10-20": { entrada: cell(3_000_00, [item(3_000_00, "Salário")]) },
      "2026-11-10": { saida: cell(500_00, [item(500_00, "Itau")]) },
      "2026-12-10": { saida: cell(500_00, [item(500_00, "Itau")]) },
    });
    const today = localDate("2026-10-05");
    // The sheet alone: lowest 4.000 on 10/12, so 3.500 to save.
    expect(project(l, today, { ...settings, cards: [itau] }).saving?.amount).toBe(3_500_00);
    // With a 1.500 ceiling each of those bills still takes 1.000: 2.000 at the lowest.
    const s = project(l, today, { ...settings, cards: [itau], cycleBudget: cents(1_500_00) });
    expect(s.saving).toMatchObject({
      amount: 1_500_00,
      lowest: 2_000_00,
      lowestDate: "2026-12-10",
    });
  });

  it("holds nothing back for bills already past the ceiling or someone else's card", () => {
    const l = ledger("2026-10-01", 92, 2_000_00, {
      "2026-10-20": { entrada: cell(3_000_00, [item(3_000_00, "Salário")]) },
      "2026-11-10": { saida: cell(2_000_00, [item(2_000_00, "Itau")]) },
      "2026-12-10": { saida: cell(500_00, [item(500_00, "Itau")]) },
      "2026-12-12": { saida: cell(800_00, [item(800_00, "Gio")]) },
    });
    const s = project(l, localDate("2026-10-05"), {
      ...settings,
      cards: [itau, gio],
      othersCards: ["Gio"],
      cycleBudget: cents(1_500_00),
    });
    // November is over the ceiling already; December's own bill takes 1.000 more, Gio's nothing:
    // the sheet's 1.700 on 12/12 is 700.
    expect(s.saving).toMatchObject({ lowest: 700_00, lowestDate: "2026-12-12" });
  });
});
