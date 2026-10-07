import { describe, expect, it } from "vitest";
import { cents, localDate, project, type Settings, thermometer } from "../src/index.ts";
import { cell, item, ledger } from "./builders.ts";

describe("thermometer", () => {
  it("uses the method's default bands: red below zero, yellow to 999, light green to 1.999", () => {
    expect(thermometer(cents(-1))).toBe("negative");
    expect(thermometer(cents(0))).toBe("attention");
    expect(thermometer(cents(999_99))).toBe("attention");
    expect(thermometer(cents(1_000_00))).toBe("healthy");
    expect(thermometer(cents(1_999_99))).toBe("healthy");
    expect(thermometer(cents(2_000_00))).toBe("surplus");
  });

  it("gives every day of each month its sheet balance and band", () => {
    const settings: Settings = {
      dailyForecast: cents(100_00),
      usualCard: "Visa",
      cycleBudget: null,
      cards: [{ name: "Visa", closingDay: 3, dueDay: 10, closingEstimated: false }],
      othersCards: [],
    };
    const l = ledger("2026-10-01", 92, 1_500_00, {
      "2026-11-10": { saida: cell(450_00, [item(450_00, "Visa")]) },
    });
    const p = project(l, localDate("2026-10-20"), settings);
    const oct = p.months.find((m) => m.month === 10);
    const nov = p.months.find((m) => m.month === 11);
    expect(oct?.days).toHaveLength(31);
    expect(oct?.days[0]).toEqual({
      day: 1,
      balance: 1_500_00,
      band: "healthy",
      future: false,
      moves: [],
    });
    expect(oct?.days[20]).toMatchObject({ day: 21, future: true });
    // Nov 10: the sheet's balance after the R$ 450 bill; the diário set in Ajustes adds nothing.
    expect(nov?.days[9]).toMatchObject({
      day: 10,
      balance: 1_500_00 - 450_00,
      future: true,
      moves: [{ kind: "card", description: "Visa", amount: 450_00 }],
    });
  });

  it("lists what moved the balance on each day: income, bills, cards, diário, untagged rest", () => {
    const settings: Settings = {
      dailyForecast: cents(0),
      usualCard: null,
      cycleBudget: null,
      cards: [],
      othersCards: [],
    };
    const l = ledger("2026-10-01", 31, 1_000_00, {
      "2026-10-05": {
        entrada: cell(3_000_00, [item(3_000_00, "Salário", null)]),
        saida: cell(1_250_00, [item(1_200_00, "Aluguel", "contas"), item(0, "Vazio", "contas")]),
        diario: cell(42_00),
      },
    });
    const p = project(l, localDate("2026-10-01"), settings);
    expect(p.months[0]?.days[4]?.moves).toEqual([
      { kind: "income", description: "Salário", amount: 3_000_00 },
      { kind: "bill", description: "Aluguel", amount: 1_200_00 },
      { kind: "bill", description: "", amount: 50_00 },
      { kind: "diario", description: "", amount: 42_00 },
    ]);
  });
});
