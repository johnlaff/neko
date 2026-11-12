import { describe, expect, it } from "vitest";
import {
  type CardConfig,
  cents,
  type LocalDate,
  localDate,
  project,
  type Scenario,
  type Settings,
  simulate,
} from "../src/index.ts";
import { cell, item, ledger } from "./builders.ts";

const settings: Settings = {
  dailyForecast: cents(0),
  usualCard: null,
  cycleBudget: null,
  cards: [],
  othersCards: [],
};
const itau: CardConfig = { name: "Itau", dueDay: 10, closingDay: 3, closingEstimated: false };
const today = localDate("2026-10-05");

/** Oct to Dec 2026: R$ 2.000 to start, salary on the 20th, the Itaú bill on Nov 10 and Dec 10. */
const sheet = () =>
  ledger("2026-10-01", 92, 2_000_00, {
    "2026-10-20": { entrada: cell(3_000_00, [item(3_000_00, "Salário")]) },
    "2026-11-10": { saida: cell(500_00, [item(500_00, "Itau")]) },
    "2026-12-10": { saida: cell(500_00, [item(500_00, "Itau")]) },
  });

const run = (scenario: Scenario, ceiling: number | null = null, due: LocalDate | null = null) => {
  const p = project(sheet(), today, { ...settings, cards: [itau] });
  return simulate(
    { today, months: p.months, due, ceiling: ceiling === null ? null : cents(ceiling) },
    scenario,
  );
};
const day = (r: ReturnType<typeof run>, date: string) => r.days.find((d) => d.date === date);

describe("simulate", () => {
  it("is the sheet as it is with no pace and no change", () => {
    const r = run({ pace: "planilha", changes: [] });
    expect(r.monthly).toBeNull();
    expect(r.days[0]?.date).toBe("2026-10-05");
    expect(r.days.at(-1)?.date).toBe("2026-12-31");
    expect(r.days.every((d) => d.sim === d.sheet)).toBe(true);
    expect(r.months.map((m) => [m.month, m.endSheet, m.endSim])).toEqual([
      [10, 5_000_00, 5_000_00],
      [11, 4_500_00, 4_500_00],
      [12, 4_000_00, 4_000_00],
    ]);
    expect(r.firstNegative).toBeNull();
  });

  it("at the ceiling, each month ahead spends what its own bills leave of it", () => {
    const r = run({ pace: "teto", changes: [] }, 1_500_00);
    expect(r.monthly).toBe(1_500_00);
    // October is today's month: its purchases are on November's bill already counted.
    expect(r.months.map((m) => [m.month, m.endSim])).toEqual([
      [10, 5_000_00],
      [11, 3_500_00],
      [12, 2_000_00],
    ]);
    expect(day(r, "2026-11-01")?.sim).toBe(4_000_00);
    // Today and 10/12 tie at R$ 2.000: the first one is the lowest.
    expect(r.lowest).toEqual({ date: "2026-10-05", balance: 2_000_00 });
    expect(day(r, "2026-12-10")?.sim).toBe(2_000_00);
  });

  it("with the ceiling and no change, saves what Hoje's Dia de guardar says", () => {
    const p = project(sheet(), today, { ...settings, cards: [itau], cycleBudget: cents(1_500_00) });
    const r = simulate(
      { today, months: p.months, due: null, ceiling: cents(1_500_00) },
      { pace: "teto", changes: [] },
    );
    expect(r.saving).toEqual(p.saving);
    expect(r.saving?.amount).toBe(1_500_00);
  });

  it("refuses the ceiling pace when no ceiling is set", () => {
    expect(() => run({ pace: "teto", changes: [] })).toThrow(RangeError);
  });

  it("as in the last three full months: their real diário and own bills, in whole reais", () => {
    const l = ledger("2026-07-01", 184, 9_000_00, {
      "2026-07-15": { diario: cell(900_00) },
      "2026-08-15": { diario: cell(1_200_00) },
      "2026-09-15": { diario: cell(1_500_00) },
      "2026-10-20": { entrada: cell(3_000_00, [item(3_000_00, "Salário")]) },
    });
    const p = project(l, today, settings);
    const r = simulate(
      { today, months: p.months, due: null, ceiling: null },
      { pace: "media", changes: [] },
    );
    expect(r.monthly).toBe(1_200_00);
    const end = (m: number) => r.months.find((x) => x.month === m);
    expect(end(10)?.endSim).toBe(end(10)?.endSheet);
    expect(end(11)?.endSim).toBe((end(11)?.endSheet ?? 0) - 1_200_00);
    expect(end(12)?.endSim).toBe((end(12)?.endSheet ?? 0) - 2_400_00);
  });

  it("refuses the last-months pace without a full month before today", () => {
    expect(() => run({ pace: "media", changes: [] })).toThrow(RangeError);
  });

  it("puts a purchase's parcels on the usual card's bills from the next one on", () => {
    const r = run(
      { pace: "planilha", changes: [{ kind: "compra", amount: cents(1_200_00), count: 3 }] },
      null,
      localDate("2026-10-10"),
    );
    expect(day(r, "2026-10-09")?.sim).toBe(2_000_00);
    expect(day(r, "2026-10-10")?.sim).toBe(1_600_00);
    expect(day(r, "2026-11-10")?.sim).toBe(4_500_00 - 800_00);
    expect(r.months.map((m) => m.endSheet - m.endSim)).toEqual([400_00, 800_00, 1_200_00]);
  });

  it("with a pace, a purchase inside it changes nothing and only what goes past it counts", () => {
    const due = localDate("2026-11-10");
    const buy = (amount: number) =>
      run(
        { pace: "teto", changes: [{ kind: "compra", amount: cents(amount), count: 1 }] },
        1_500_00,
        due,
      ).months.map((m) => m.endSim);
    // November's own bill is 500 of a 1.500 ceiling: a 600 purchase still fits.
    expect(buy(600_00)).toEqual([5_000_00, 3_500_00, 2_000_00]);
    // 1.600 goes 600 past it: November and December end 600 lower.
    expect(buy(1_600_00)).toEqual([5_000_00, 2_900_00, 1_400_00]);
  });

  it("tells what a purchase's first parcel leaves of Ainda cabem", () => {
    const p = project(sheet(), today, { ...settings, cards: [itau] });
    const cs = { budget: cents(1_500_00), accumulated: cents(500_00), due: "2026-11-10" };
    const r = simulate(
      {
        today,
        months: p.months,
        due: localDate("2026-11-10"),
        ceiling: null,
        canSpend: cs as never,
      },
      { pace: "planilha", changes: [{ kind: "compra", amount: cents(900_00), count: 3 }] },
    );
    expect(r.cycle).toEqual({ remaining: 700_00, due: "2026-11-10" });
    expect(run({ pace: "planilha", changes: [] }).cycle).toBeNull();
  });

  it("refuses a purchase without a card to put it on", () => {
    expect(() =>
      run({ pace: "planilha", changes: [{ kind: "compra", amount: cents(100_00), count: 1 }] }),
    ).toThrow(RangeError);
  });

  it("repeats money in and out on the same day each month, and names the first red day", () => {
    const r = run({
      pace: "planilha",
      changes: [
        { kind: "saida", amount: cents(3_000_00), date: localDate("2026-10-15"), months: 2 },
        { kind: "entrada", amount: cents(500_00), date: localDate("2026-12-01"), months: 1 },
      ],
    });
    expect(day(r, "2026-10-14")?.sim).toBe(2_000_00);
    expect(day(r, "2026-10-15")?.sim).toBe(-1_000_00);
    expect(r.firstNegative).toEqual({ date: "2026-10-15", balance: -1_000_00 });
    expect(r.sheetFirstNegative).toBeNull();
    expect(r.months.map((m) => m.endSheet - m.endSim)).toEqual([3_000_00, 6_000_00, 5_500_00]);
    // November takes the second 3.000 after its Itaú bill: the lowest day of the three months.
    expect(r.lowest).toEqual({ date: "2026-11-15", balance: -1_500_00 });
  });

  it("tells what the changes take from the lowest balance and the end, against the pace alone", () => {
    const changes: Scenario["changes"] = [
      { kind: "saida", amount: cents(3_000_00), date: localDate("2026-10-15"), months: 2 },
      { kind: "entrada", amount: cents(500_00), date: localDate("2026-12-01"), months: 1 },
    ];
    // The sheet alone: lowest R$ 2.000 today, R$ 4.000 at the end of December.
    expect(run({ pace: "planilha", changes }).effect).toEqual({
      lowest: -3_500_00,
      end: -5_500_00,
    });
    // With a pace it is against that pace without the changes, not against the sheet.
    const teto = run({ pace: "teto", changes }, 1_500_00);
    const alone = run({ pace: "teto", changes: [] }, 1_500_00);
    expect(teto.effect).toEqual({
      lowest: (teto.lowest?.balance ?? 0) - (alone.lowest?.balance ?? 0),
      end: (teto.months.at(-1)?.endSim ?? 0) - (alone.months.at(-1)?.endSim ?? 0),
    });
    expect(alone.effect).toBeNull();
    expect(alone.effects).toEqual([]);
  });

  it("tells each change's own effect, as if it were the only one", () => {
    const r = run({
      pace: "planilha",
      changes: [
        { kind: "saida", amount: cents(3_000_00), date: localDate("2026-10-15"), months: 2 },
        { kind: "entrada", amount: cents(500_00), date: localDate("2026-12-01"), months: 1 },
      ],
    });
    expect(r.effects).toEqual([
      // Alone the second 3.000 meets December's bill too: R$ -2.000 on 10/12.
      { lowest: -4_000_00, end: -6_000_00, inPace: null, counted: 2, of: 2 },
      { lowest: 0, end: 500_00, inPace: null, counted: 1, of: 1 },
    ]);
  });

  it("says which of a purchase's parcels the pace already holds, and how much of each month", () => {
    // R$ 1.200 in 3: R$ 400 on 10/10 (this month, past the pace), 10/11 and 10/12 (inside it).
    const r = run(
      { pace: "teto", changes: [{ kind: "compra", amount: cents(1_200_00), count: 3 }] },
      1_500_00,
      localDate("2026-10-10"),
    );
    expect(r.effects).toEqual([
      {
        lowest: -400_00,
        end: -400_00,
        inPace: { count: 2, amount: 800_00, perMonth: 400_00, until: "2026-12" },
        counted: 3,
        of: 3,
      },
    ]);
    // Past what is left of the ceiling only that part is held: 1.000 of 1.600 in November.
    const big = run(
      { pace: "teto", changes: [{ kind: "compra", amount: cents(1_600_00), count: 1 }] },
      1_500_00,
      localDate("2026-11-10"),
    );
    expect(big.effects[0]?.inPace).toEqual({
      count: 1,
      amount: 1_000_00,
      perMonth: 1_000_00,
      until: "2026-11",
    });
    expect(big.effects[0]?.end).toBe(-600_00);
    // On the sheet as it is nothing holds a purchase: all of it moves the balances.
    const plain = run(
      { pace: "planilha", changes: [{ kind: "compra", amount: cents(1_200_00), count: 3 }] },
      null,
      localDate("2026-10-10"),
    );
    expect(plain.effects[0]?.inPace).toBeNull();
  });

  it("names the months whose bills already take the whole pace, where nothing else is spent", () => {
    const buy = (amount: number, pace: "teto" | "planilha" = "teto") =>
      run(
        { pace, changes: [{ kind: "compra", amount: cents(amount), count: 1 }] },
        pace === "teto" ? 1_500_00 : null,
        localDate("2026-11-10"),
      ).full;
    // November's 500 bill and a 1.600 purchase pass the 1.500 ceiling: nothing left for the rest.
    expect(buy(1_600_00)).toEqual(["2026-11"]);
    expect(buy(600_00)).toEqual([]);
    expect(buy(1_600_00, "planilha")).toEqual([]);
  });

  it("offers nothing to save on a best case: the full months leave the day to day out", () => {
    const saving = (amount: number) =>
      run(
        { pace: "teto", changes: [{ kind: "compra", amount: cents(amount), count: 1 }] },
        1_500_00,
        localDate("2026-11-10"),
      ).saving;
    expect(saving(600_00)).not.toBeNull();
    expect(saving(1_600_00)).toBeNull();
  });

  it("counts only the dates the sheet reaches", () => {
    const r = run(
      {
        pace: "planilha",
        changes: [
          { kind: "saida", amount: cents(100_00), date: localDate("2026-12-15"), months: 3 },
          { kind: "compra", amount: cents(1_200_00), count: 12 },
        ],
      },
      null,
      localDate("2026-10-10"),
    );
    expect(r.effects.map((e) => [e.counted, e.of])).toEqual([
      [1, 3],
      [3, 12],
    ]);
  });

  it("counts extra money in as income when it looks for the payday", () => {
    const r = run({
      pace: "planilha",
      changes: [
        { kind: "entrada", amount: cents(9_000_00), date: localDate("2026-10-25"), months: 1 },
      ],
    });
    expect(r.saving?.date).toBe("2026-10-25");
  });

  it("refuses changes in the past, empty amounts, bad repeats and too many changes", () => {
    const out = (date: string, amount = 100_00, months = 1) => ({
      kind: "saida" as const,
      amount: cents(amount),
      date: localDate(date),
      months,
    });
    expect(() => run({ pace: "planilha", changes: [out("2026-10-04")] })).toThrow(RangeError);
    expect(() => run({ pace: "planilha", changes: [out("2026-10-06", 0)] })).toThrow(RangeError);
    expect(() => run({ pace: "planilha", changes: [out("2026-10-06", 100, 0)] })).toThrow(
      RangeError,
    );
    expect(() => run({ pace: "planilha", changes: [out("2026-10-06", 100, 25)] })).toThrow(
      RangeError,
    );
    expect(() =>
      run({ pace: "planilha", changes: Array.from({ length: 9 }, () => out("2026-10-06")) }),
    ).toThrow(RangeError);
  });
});
