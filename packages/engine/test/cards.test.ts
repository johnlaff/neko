import { describe, expect, it } from "vitest";
import {
  billOnSheet,
  type CardConfig,
  cycleContaining,
  cycleForDueMonth,
  inferCards,
  localDate,
  mergeCards,
  normalizeName,
} from "../src/index.ts";
import { cell, item, ledger } from "./builders.ts";

const card = (closingDay: number, dueDay: number): CardConfig => ({
  name: "Visa",
  closingDay,
  dueDay,
  closingEstimated: false,
});

describe("card cycles", () => {
  it("closes in the due month when closing day < due day", () => {
    expect(cycleForDueMonth(card(3, 10), 2026, 10)).toEqual({
      start: "2026-09-03",
      closing: "2026-10-03",
      due: "2026-10-10",
    });
  });
  it("closes in the previous month otherwise, clamped (v1: 2026-03, 29, 12 → 02-28)", () => {
    expect(cycleForDueMonth(card(29, 12), 2026, 3)).toMatchObject({
      closing: "2026-02-28",
      due: "2026-03-12",
    });
  });
  it("a purchase on the closing day lands on that bill; the next day goes to the next one", () => {
    expect(cycleContaining(card(20, 28), localDate("2026-01-20")).due).toBe("2026-01-28");
    expect(cycleContaining(card(20, 28), localDate("2026-01-21")).due).toBe("2026-02-28");
  });
  it("handles a cycle crossing the year", () => {
    expect(cycleContaining(card(25, 5), localDate("2026-12-30")).due).toBe("2027-02-05");
    expect(cycleContaining(card(25, 5), localDate("2026-12-20")).due).toBe("2027-01-05");
  });
});

describe("a bill on the sheet", () => {
  const visa = card(3, 10);
  const days = ledger("2026-09-01", 100, 0, {
    "2026-10-08": { saida: cell(100, [item(100, "Visa")]) },
    "2026-10-12": { saida: cell(200, [item(200, "visa")]) },
    // 16 days after Oct 10 and 15 before Nov 10: November's, paid early.
    "2026-10-26": { saida: cell(400, [item(400, "Visa")]) },
  });
  it("reads only the due day of a bill still to pay", () => {
    expect(billOnSheet(days, visa, localDate("2026-10-10"))).toBe(0);
    expect(billOnSheet(days, visa, localDate("2026-11-10"))).toBe(0);
    expect(billOnSheet(days, visa, localDate("2027-01-10"))).toBeNull();
  });
  it("gives a bill already due every line nearer its due day than the card's other ones", () => {
    expect(billOnSheet(days, visa, localDate("2026-10-10"), true)).toBe(300);
    expect(billOnSheet(days, visa, localDate("2026-11-10"), true)).toBe(400);
    expect(billOnSheet(days, visa, localDate("2026-09-10"), true)).toBe(0);
  });
});

describe("card names", () => {
  it("ignores tags, cycle suffixes, case and accents", () => {
    expect(normalizeName("Cartão Azul #reembolso")).toBe("cartao azul");
    expect(normalizeName("Nubank (26/02)")).toBe("nubank");
  });
  it("infers cards and their most common due day from the notes", () => {
    const l = ledger("2026-09-01", 61, 0, {
      "2026-09-10": { saida: cell(100, [item(100, "Itau")]) },
      "2026-10-10": { saida: cell(0, [item(0, "Itau"), item(0, "Conta de luz", "contas")]) },
      "2026-10-26": { saida: cell(50, [item(50, "Nubank (26/10)")]) },
    });
    expect(inferCards(l)).toEqual([
      { name: "Itau", dueDay: 10, closingDay: 3, closingEstimated: true },
      { name: "Nubank", dueDay: 26, closingDay: 19, closingEstimated: true },
    ]);
  });
  it("follows where the latest bills sit when a card's due day moved", () => {
    const l = ledger("2026-01-01", 300, 0, {
      "2026-01-26": { saida: cell(50, [item(50, "Nubank")]) },
      "2026-02-26": { saida: cell(50, [item(50, "Nubank")]) },
      "2026-03-26": { saida: cell(50, [item(50, "Nubank")]) },
      "2026-04-26": { saida: cell(50, [item(50, "Nubank")]) },
      "2026-06-29": { saida: cell(50, [item(50, "Nubank")]) },
      "2026-09-04": { saida: cell(50, [item(50, "Nubank")]) },
      "2026-10-04": { saida: cell(50, [item(50, "Nubank")]) },
    });
    expect(inferCards(l).map((c) => c.dueDay)).toEqual([4]);
  });
  it("configured cards replace inferred ones", () => {
    const merged = mergeCards(
      [{ name: "Itau", dueDay: 10, closingDay: 3, closingEstimated: true }],
      [{ name: "itaú", dueDay: 10, closingDay: 1 }],
    );
    expect(merged).toEqual([{ name: "itaú", dueDay: 10, closingDay: 1, closingEstimated: false }]);
  });
});
