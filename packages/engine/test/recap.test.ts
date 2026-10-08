import { describe, expect, it } from "vitest";
import { cents, localDate, type MonthView, monthRecap, monthWins } from "../src/index.ts";

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
      wins: [{ kind: "blue", months: 2 }],
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

  describe("wins: what the closed month achieved, straight from the sheet", () => {
    const at = (y: number, m: number, extra: Partial<MonthView>) => month(y, m, 3000_00, extra);
    const winsOn = (ms: MonthView[], d = "2026-10-02") => monthRecap(ms, localDate(d))?.wins;

    it("counts the months in a row that ended in the blue", () => {
      const ms = [
        at(2026, 6, { result: cents(-10_00) }),
        at(2026, 7, {}),
        at(2026, 8, {}),
        at(2026, 9, {}),
      ];
      expect(winsOn(ms)).toContainEqual({ kind: "blue", months: 3 });
      expect(winsOn([at(2026, 9, { result: cents(0) })])).toEqual([]);
    });

    it("praises keeping the method's 20% of the income", () => {
      expect(winsOn([at(2026, 9, { savedShare: 20 })])).toContainEqual({ kind: "kept", share: 20 });
      expect(winsOn([at(2026, 9, { savedShare: 19 })])).not.toContainEqual(
        expect.objectContaining({ kind: "kept" }),
      );
    });

    it("marks the month the reserve first covered 1, 3, 6 or 12 months of living", () => {
      const ms = [
        at(2026, 7, { saved: cents(2000_00), result: cents(-1) }),
        at(2026, 8, { saved: cents(500_00), result: cents(-1) }),
        // 2.000 + 500 + 7.000 = 9.500 over a 3.000 living cost: crosses 3 months in September.
        at(2026, 9, { saved: cents(7000_00), result: cents(-1) }),
      ];
      expect(winsOn(ms)).toEqual([{ kind: "reserve", months: 3 }]);
      expect(winsOn(ms.slice(0, 2), "2026-09-02")).toEqual([]);
    });

    it("marks own card bills paid in the month at least 5% below the month before's", () => {
      const card = (label: string, amount: number, others = false) => ({
        label,
        amount: cents(amount),
        count: 1,
        kind: "card",
        change: null,
        countBefore: null,
        others,
      });
      const ms = (aug: object[], sep: object[]) => [
        at(2026, 8, { outflows: aug, result: cents(-1) } as Partial<MonthView>),
        at(2026, 9, { outflows: sep, result: cents(-1) } as Partial<MonthView>),
      ];
      const down = { kind: "cards-down" };
      // 3.000 to 2.800 is a step down; the partner's card does not count either way.
      expect(
        winsOn(ms([card("Azul", 3000_00)], [card("Azul", 2800_00), card("Gio", 900_00, true)])),
      ).toEqual([down]);
      // Under 5% is noise, and no card the month before has nothing to compare.
      expect(winsOn(ms([card("Azul", 3000_00)], [card("Azul", 2900_00)]))).toEqual([]);
      expect(winsOn(ms([], [card("Azul", 100_00)]))).toEqual([]);
      // A month without lines in between: no "month before" to compare with.
      const gap = [
        at(2026, 7, { outflows: [card("Azul", 3000_00)], result: cents(-1) } as Partial<MonthView>),
        at(2026, 9, { outflows: [card("Azul", 1000_00)], result: cents(-1) } as Partial<MonthView>),
      ];
      expect(winsOn(gap)).toEqual([]);
    });

    it("marks a record share kept, once there are three months before it to beat", () => {
      const ms = [
        at(2026, 5, { savedShare: 12 }),
        at(2026, 6, { savedShare: 18 }),
        at(2026, 7, { savedShare: 9 }),
        at(2026, 8, { savedShare: 19, result: cents(-1) }),
        at(2026, 9, { savedShare: 15 }),
      ];
      expect(winsOn(ms, "2026-09-02")).toEqual([{ kind: "record", share: 19 }]);
      expect(winsOn(ms)).not.toContainEqual(expect.objectContaining({ kind: "record" }));
      // Too few months before it: the first months would all be records.
      expect(winsOn(ms.slice(1, 4), "2026-09-02")).toEqual([]);
      // A record says the share, so it takes the place of the 20% goal.
      expect(
        winsOn(
          [...ms.slice(0, 3), at(2026, 8, { savedShare: 25, result: cents(-1) })],
          "2026-09-02",
        ),
      ).toEqual([{ kind: "record", share: 25 }]);
      // A tie is not a record, and nothing kept is never one.
      expect(
        winsOn(
          [...ms.slice(0, 3), at(2026, 8, { savedShare: 18, result: cents(-1) })],
          "2026-09-02",
        ),
      ).toEqual([]);
    });
  });

  describe("monthWins: a closed month keeps its wins after the recap leaves Hoje", () => {
    const at = (y: number, m: number, extra: Partial<MonthView>) => month(y, m, 3000_00, extra);

    it("reads only the months up to the one asked, as its recap did", () => {
      const ms = [at(2026, 7, {}), at(2026, 8, { savedShare: 25 }), at(2026, 9, {})];
      expect(monthWins(ms, 2026, 8)).toEqual([
        { kind: "blue", months: 2 },
        { kind: "kept", share: 25 },
      ]);
      expect(monthWins(ms, 2026, 9)).toEqual(monthRecap(ms, localDate("2026-10-03"))?.wins);
    });

    it("has none for a month the sheet has no lines for, or does not have", () => {
      const empty = month(2026, 9, 0, { entrada: cents(0) });
      expect(monthWins([empty], 2026, 9)).toEqual([]);
      expect(monthWins([at(2026, 9, {})], 2026, 5)).toEqual([]);
    });
  });
});
