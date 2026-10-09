import { describe, expect, it } from "vitest";
import {
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
