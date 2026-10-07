import { describe, expect, it } from "vitest";
import { type CardConfig, cents, localDate, project, type Settings } from "../src/index.ts";
import { cell, item, ledger } from "./builders.ts";

// The method's only forecast is the one the person writes into the sheet. Neko shows the sheet's
// balances and bills as they are, whatever the diário set in Ajustes or the cards' past bills.
const visa: CardConfig = { name: "Visa", closingDay: 3, dueDay: 10, closingEstimated: false };
const itau: CardConfig = { name: "Itau", closingDay: 3, dueDay: 10, closingEstimated: false };
const settings: Settings = {
  dailyForecast: cents(100_00),
  usualCard: "Visa",
  cycleBudget: null,
  cards: [visa, itau],
  othersCards: [],
};
const l = ledger("2026-07-01", 184, 20_000_00, {
  "2026-08-10": { saida: cell(800_00, [item(500_00, "Visa"), item(300_00, "Itau")]) },
  "2026-09-10": { saida: cell(900_00, [item(500_00, "Visa"), item(400_00, "Itau")]) },
  "2026-11-10": { saida: cell(450_00, [item(450_00, "Visa")]) },
});

describe("the sheet is the truth", () => {
  const p = project(l, localDate("2026-10-20"), settings);

  it("ends each month on the sheet's balance, adding no spending of its own", () => {
    const nov = p.months.find((m) => m.month === 11);
    expect(nov?.endSheet).toBe(20_000_00 - 800_00 - 900_00 - 450_00);
    expect(nov?.days.at(-1)?.balance).toBe(nov?.endSheet);
  });

  it("shows each open bill as the sheet holds it", () => {
    expect(p.cards.map((c) => [c.card.name, c.onSheet])).toEqual([
      ["Visa", 450_00],
      ["Itau", 0],
    ]);
  });

  it("lists only the sheet's lines as a day's moves", () => {
    const nov = p.months.find((m) => m.month === 11);
    expect(nov?.days[9]?.moves).toEqual([{ kind: "card", description: "Visa", amount: 450_00 }]);
  });

  it("gives each month's result as the change in the sheet's balance", () => {
    const nov = p.months.find((m) => m.month === 11);
    expect(nov?.result).toBe(-450_00);
  });
});
