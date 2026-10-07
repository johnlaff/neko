import { describe, expect, it } from "vitest";
import { type CardConfig, localDate, missingBills } from "../src/index.ts";
import { cell, item, ledger } from "./builders.ts";

const card: CardConfig = {
  name: "Cartão Azul",
  dueDay: 12,
  closingDay: 5,
  closingEstimated: false,
};
const today = localDate("2026-10-20");
const bill = (amount: number, name = "Cartão Azul") => ({
  saida: cell(amount, [item(amount, name)]),
});

describe("missing bills", () => {
  it("flags the last due bill of an active card that is not on the sheet", () => {
    const l = ledger("2026-08-01", 90, 0, { "2026-09-12": bill(500_00) });
    expect(missingBills(l, [card], today)).toMatchObject([
      { kind: "missing-bill", date: "2026-10-12", card: "Cartão Azul" },
    ]);
  });
  it("accepts the bill written a few days off the due day (weekends, holidays)", () => {
    const l = ledger("2026-08-01", 90, 0, {
      "2026-09-12": bill(500_00),
      "2026-10-14": bill(480_00),
    });
    expect(missingBills(l, [card], today)).toEqual([]);
  });
  it("accepts a bill written as R$ 0,00", () => {
    const l = ledger("2026-08-01", 90, 0, { "2026-09-12": bill(500_00), "2026-10-12": bill(0) });
    expect(missingBills(l, [card], today)).toEqual([]);
  });
  it("ignores a card with no bill in the two months before (no longer used)", () => {
    const l = ledger("2026-06-01", 150, 0, { "2026-07-12": bill(500_00) });
    expect(missingBills(l, [card], today)).toEqual([]);
  });
  it("waits until the due day has passed", () => {
    const l = ledger("2026-08-01", 90, 0, { "2026-09-12": bill(500_00) });
    expect(missingBills(l, [card], localDate("2026-10-12"))).toEqual([]);
  });
  it("matches the card name ignoring case and accents", () => {
    const l = ledger("2026-08-01", 90, 0, {
      "2026-09-12": bill(500_00),
      "2026-10-12": bill(300_00, "cartao azul"),
    });
    expect(missingBills(l, [card], today)).toEqual([]);
  });
});
