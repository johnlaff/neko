import { describe, expect, it } from "vitest";
import { cents, insights, localDate, type Projection } from "../src/index.ts";

type Month = Projection["months"][number];
const month = (y: number, m: number, end: number, extra: Partial<Month> = {}): Month =>
  ({ year: y, month: m, endProjected: cents(end), outflows: [], fixed: [], ...extra }) as Month;
/** A month whose day `d` ends at `balances[d]`, or `rest` when not listed. */
const daily = (y: number, m: number, rest: number, balances: Record<number, number> = {}) => {
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days = Array.from({ length: n }, (_, i) => {
    const balance = cents(balances[i + 1] ?? rest);
    return { day: i + 1, balance, band: "surplus" as const, future: true, moves: [] };
  });
  return month(y, m, days.at(-1)?.balance ?? 0, { days });
};
const usual = { usual: true, card: { name: "Cartão Azul" } } as Projection["cards"][number];

const base = {
  today: localDate("2026-10-05"),
  balanceToday: cents(1_000_00),
  months: [month(2026, 10, 500_00), month(2026, 11, 200_00), month(2026, 12, 300_00)],
  cards: [usual],
  historyAverage: cents(3_000_00),
  openVsAverage: cents(0),
} satisfies Parameters<typeof insights>[0];

describe("insights", () => {
  it("says nothing when all is calm", () => {
    expect(insights(base)).toEqual([]);
  });

  it("warns from the first red day ahead, with the deepest one, even if the month ends green", () => {
    const months = [
      daily(2026, 10, 500_00, { 1: -50_00, 2: -80_00 }),
      daily(2026, 11, 300_00, { 2: -1_103_30, 3: -1_176_63, 10: -2_739_94, 11: -2_000_00 }),
      daily(2026, 12, 900_00),
    ];
    expect(insights({ ...base, months })).toEqual([
      {
        kind: "goes-negative",
        start: "2026-11-02",
        deepest: -2_739_94,
        deepestDate: "2026-11-10",
      },
    ]);
  });

  it("stays quiet about red days already past, beyond four months, or from a red balance", () => {
    const past = [daily(2026, 10, 500_00, { 1: -50_00, 4: -10_00 })];
    expect(insights({ ...base, months: past })).toEqual([]);
    const far = [
      daily(2026, 10, 500_00),
      daily(2026, 11, 500_00),
      daily(2026, 12, 500_00),
      daily(2027, 1, 500_00),
      daily(2027, 2, 500_00, { 3: -1_00 }),
    ];
    expect(insights({ ...base, months: far })).toEqual([]);
    const red = [daily(2026, 10, -500_00)];
    expect(insights({ ...base, months: red, balanceToday: cents(-50_00) })).toEqual([]);
  });

  it("flags the usual bill only past R$ 100 and 15% above its average", () => {
    expect(insights({ ...base, openVsAverage: cents(400_00) })).toEqual([]);
    expect(insights({ ...base, openVsAverage: cents(451_00) })).toEqual([
      { kind: "bill-above-average", card: "Cartão Azul", over: 451_00, average: 3_000_00 },
    ]);
  });

  it("flags the fixed bill that went up the most, ignoring installments and cards", () => {
    const oct = month(2026, 10, 500_00, {
      fixed: [
        { label: "Eletricidade", amount: cents(260_00), installment: null },
        { label: "Uniube", amount: cents(430_00), installment: null },
      ],
      outflows: [
        {
          label: "Eletricidade",
          amount: cents(260_00),
          count: 1,
          kind: "bill",
          change: cents(45_00),
          countBefore: 1,
          others: false,
        },
        {
          label: "uniube",
          amount: cents(430_00),
          count: 1,
          kind: "bill",
          change: cents(118_00),
          countBefore: 1,
          others: false,
        },
        {
          label: "Nubank",
          amount: cents(900_00),
          count: 1,
          kind: "card",
          change: cents(300_00),
          countBefore: 1,
          others: false,
        },
        {
          label: "Presente",
          amount: cents(300_00),
          count: 1,
          kind: "bill",
          change: cents(200_00),
          countBefore: 1,
          others: false,
        },
      ],
    });
    expect(insights({ ...base, months: [oct] })).toEqual([
      { kind: "fixed-up", label: "uniube", amount: 430_00, change: 118_00 },
    ]);
  });

  it("does not call a second charge of the same bill a price increase", () => {
    const oct = month(2026, 10, 500_00, {
      fixed: [{ label: "Aulas Inglês", amount: cents(464_00), installment: null }],
      outflows: [
        {
          label: "Aulas Inglês",
          amount: cents(464_00),
          count: 2,
          kind: "bill",
          change: cents(232_00),
          countBefore: 1,
          others: false,
        },
      ],
    });
    expect(insights({ ...base, months: [oct] })).toEqual([]);
  });

  it("asks to confirm the usual card's closing day while it is only estimated, last", () => {
    const guessed = {
      usual: true,
      card: { name: "Cartão Azul", closingEstimated: true },
      cycle: { closing: localDate("2026-10-05") },
    } as Projection["cards"][number];
    expect(insights({ ...base, cards: [guessed] })).toEqual([
      { kind: "closing-estimated", card: "Cartão Azul", closing: "2026-10-05" },
    ]);
    const months = [daily(2026, 10, 500_00, { 20: -1_00 })];
    expect(insights({ ...base, months, cards: [guessed] }).map((i) => i.kind)).toEqual([
      "goes-negative",
      "closing-estimated",
    ]);
  });
});
