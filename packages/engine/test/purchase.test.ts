import { describe, expect, it } from "vitest";
import {
  type CardConfig,
  cents,
  checkPurchase,
  type LocalDate,
  localDate,
  project,
  type Settings,
} from "../src/index.ts";
import { cell, type DaySpec, item, ledger } from "./builders.ts";

const itau: CardConfig = { name: "Itau", dueDay: 10, closingDay: 3, closingEstimated: false };
const today = localDate("2026-10-05");
const DUE = localDate("2026-11-10");

/**
 * Oct to Dec 2026: R$ 2.000 to start, salary of R$ 3.000 on the 20th, the Itaú bill of R$ 500 on
 * Nov 10 and R$ 1.200 on Dec 10. The ceiling is R$ 1.500 and the bank already shows R$ 500 on
 * November's bills.
 */
const base: Record<string, DaySpec> = {
  "2026-10-20": { entrada: cell(3_000_00, [item(3_000_00, "Salário")]) },
  "2026-11-10": { saida: cell(500_00, [item(500_00, "Itau")]) },
  "2026-12-10": { saida: cell(1_200_00, [item(1_200_00, "Itau")]) },
};

const input = (
  opts: { ceiling?: boolean; extra?: Record<string, DaySpec>; due?: LocalDate | null } = {},
) => {
  const ceiling = opts.ceiling ?? true;
  const settings: Settings = {
    dailyForecast: cents(0),
    usualCard: "Itau",
    cycleBudget: ceiling ? cents(1_500_00) : null,
    cardsSpent: ceiling ? cents(500_00) : null,
    pixSpent: ceiling ? cents(0) : null,
    cards: [itau],
    othersCards: [],
  };
  const p = project(
    ledger("2026-10-01", 92, 2_000_00, { ...base, ...opts.extra }),
    today,
    settings,
  );
  return {
    today,
    months: p.months,
    due: opts.due === undefined ? DUE : opts.due,
    ceiling: ceiling ? cents(1_500_00) : null,
    canSpend: ceiling ? p.canSpend : null,
  };
};

const card = (amount: number, count = 1) => ({
  amount: cents(amount),
  count,
  via: "cartao" as const,
});
const pix = (amount: number) => ({ amount: cents(amount), count: 1, via: "pix" as const });

describe("checkPurchase", () => {
  it("fits when the first parcel stays inside the month's ceiling and nothing goes red", () => {
    const r = checkPurchase(input(), card(600_00));
    expect(r.verdict).toBe("cabe");
    expect(r.reasons).toEqual([]);
    expect(r.pace).toBe("teto");
    // R$ 1.500 of ceiling, R$ 500 already on November's bills, R$ 600 more.
    expect(r.now).toEqual({ remaining: 400_00, due: "2026-11-30" });
    expect(r.parcels).toEqual([{ date: "2026-11-10", amount: 600_00 }]);
    expect(r.tight).toEqual([]);
  });

  it("does not fit when it goes past what is left of the month's ceiling", () => {
    const r = checkPurchase(input(), card(1_200_00));
    expect(r.verdict).toBe("nao_cabe");
    expect(r.reasons).toEqual(["teto"]);
    expect(r.now?.remaining).toBe(-200_00);
  });

  it("is tight when a later parcel takes a month's bills to the ceiling", () => {
    // R$ 300 a month: November keeps R$ 700, December's R$ 1.200 bill reaches R$ 1.500.
    const r = checkPurchase(input(), card(600_00, 2));
    expect(r.verdict).toBe("aperta");
    expect(r.reasons).toEqual(["meses"]);
    expect(r.now?.remaining).toBe(700_00);
    expect(r.tight).toEqual([{ month: "2026-12", bills: 1_500_00 }]);
    expect(r.parcels).toEqual([
      { date: "2026-11-10", amount: 300_00 },
      { date: "2026-12-10", amount: 300_00 },
    ]);
  });

  it("is tight when the parcels outlast the thing, the method's rule for splitting", () => {
    // R$ 100 a month for 3 months is fine for the money, but a dinner is gone the same night.
    const dinner = checkPurchase(input(), { ...card(300_00, 3), lifeMonths: 0 });
    expect(dinner.verdict).toBe("aperta");
    expect(dinner.reasons).toEqual(["duracao"]);
    // A chair that lasts years, or one paid off as it wears out, is not held back.
    expect(checkPurchase(input(), { ...card(300_00, 3), lifeMonths: 60 }).reasons).toEqual([]);
    expect(checkPurchase(input(), { ...card(300_00, 3), lifeMonths: 3 }).reasons).toEqual([]);
    // At once, nothing outlasts it; and a purchase that does not fit stays that way.
    expect(checkPurchase(input(), { ...card(300_00), lifeMonths: 0 }).reasons).toEqual([]);
    const tv = checkPurchase(input(), { ...card(2_400_00, 2), lifeMonths: 1 });
    expect(tv.verdict).toBe("nao_cabe");
    expect(tv.reasons).toEqual(["teto", "meses", "duracao"]);
  });

  it("lists every parcel, even past the sheet's last month", () => {
    const r = checkPurchase(input(), card(1_000_00, 3));
    expect(r.parcels).toEqual([
      { date: "2026-11-10", amount: 333_34 },
      { date: "2026-12-10", amount: 333_33 },
      { date: "2027-01-10", amount: 333_33 },
    ]);
  });

  it("counts a Pix today against the month's ceiling too", () => {
    expect(checkPurchase(input(), pix(600_00)).now?.remaining).toBe(400_00);
    const over = checkPurchase(input(), pix(1_100_00));
    expect(over.verdict).toBe("nao_cabe");
    expect(over.reasons).toEqual(["teto"]);
    expect(over.parcels).toEqual([{ date: "2026-10-05", amount: 1_100_00 }]);
  });

  it("does not fit when it takes the balance below zero, with or without a ceiling", () => {
    // R$ 2.000 today and the salary only on the 20th.
    const r = checkPurchase(input({ ceiling: false }), pix(2_100_00));
    expect(r.verdict).toBe("nao_cabe");
    expect(r.reasons).toEqual(["negativo"]);
    expect(r.pace).toBe("planilha");
    expect(r.now).toBeNull();
    expect(r.firstNegative.with).toEqual({ date: "2026-10-05", balance: -100_00 });
    expect(r.firstNegative.without).toBeNull();
    expect(checkPurchase(input({ ceiling: false }), pix(2_000_00)).verdict).toBe("cabe");
  });

  it("is tight when the balance already goes below zero without it, and worse when earlier", () => {
    const extra = { "2026-10-15": { saida: cell(2_500_00, [item(2_500_00, "Conserto")]) } };
    const small = checkPurchase(input({ ceiling: false, extra }), pix(100_00));
    expect(small.verdict).toBe("aperta");
    expect(small.reasons).toEqual(["ja_negativo"]);
    expect(small.firstNegative.without).toEqual({ date: "2026-10-15", balance: -500_00 });
    expect(small.lowest.with?.balance).toBe(-600_00);
    // Below zero from today instead of the 15th: the purchase brings it earlier.
    const big = checkPurchase(input({ ceiling: false, extra }), pix(2_100_00));
    expect(big.verdict).toBe("nao_cabe");
    expect(big.reasons).toEqual(["negativo"]);
  });

  it("tells what the payday lets you set aside with and without it", () => {
    const r = checkPurchase(input({ ceiling: false }), pix(500_00));
    expect(r.saving.without?.date).toBe("2026-10-20");
    expect(r.saving.with?.date).toBe("2026-10-20");
    expect((r.saving.without?.amount ?? 0) - (r.saving.with?.amount ?? 0)).toBe(500_00);
  });

  it("leaves the ceiling out when the first parcel lands past the month it measures", () => {
    const later = { ...input(), canSpend: { ...input().canSpend, due: "2026-10-31" } as never };
    const r = checkPurchase(later, card(600_00));
    expect(r.now).toBeNull();
  });

  it("refuses a card purchase without a card, a Pix in parcels and an empty amount", () => {
    expect(() => checkPurchase(input({ due: null }), card(100_00))).toThrow(RangeError);
    expect(() => checkPurchase(input(), { amount: cents(100_00), count: 2, via: "pix" })).toThrow(
      RangeError,
    );
    expect(() => checkPurchase(input(), card(0))).toThrow(RangeError);
    expect(() => checkPurchase(input(), card(100_00, 0))).toThrow(RangeError);
  });
});
