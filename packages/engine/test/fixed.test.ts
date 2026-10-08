import { describe, expect, it } from "vitest";
import { cents, type Fixed, fixedOf, monthFixed, monthOutflows } from "../src/index.ts";
import { cell, item, ledger } from "./builders.ts";

describe("monthFixed", () => {
  const rows = ledger("2026-07-01", 123, 10_000_00, {
    "2026-07-05": {
      saida: cell(1_484_00 + 1_006_00, [
        item(1_484_00, "Aluguel", "contas"),
        item(1_006_00, "Financiamento Carro 10/36", "contas"),
      ]),
    },
    "2026-08-05": {
      saida: cell(1_484_00 + 1_006_00 + 3_000_00, [
        item(1_484_00, "Aluguel", "contas"),
        item(1_006_00, "Financiamento Carro 11/36", "contas"),
        item(3_000_00, "Cartão Azul"),
      ]),
    },
    "2026-09-05": {
      saida: cell(1_006_00 + 3_000_00 + 200_00, [
        item(1_006_00, "Financiamento Carro 12/36", "contas"),
        item(3_000_00, "Cartão Azul"),
        item(200_00, "Uniube", "contas"),
      ]),
    },
    "2026-10-05": {
      saida: cell(1_484_00 + 1_006_00 + 3_000_00 + 175_00 + 90_00, [
        item(1_484_00, "aluguel ", "contas"),
        item(1_006_00, "Financiamento Carro 13/36", "contas"),
        item(3_000_00, "Cartão Azul"),
        item(175_00, "Aluguel Terno 1/2", null),
        item(90_00, "Presente", null),
      ]),
    },
    "2026-10-20": { saida: cell(200_00, [item(200_00, "Uniube #faculdade", "contas")]) },
  });

  it("lists installments and bills seen in at least two of the three months before", () => {
    expect(monthFixed(rows, 2026, 10)).toEqual([
      { label: "Aluguel", amount: 1_484_00, installment: null },
      {
        label: "Financiamento Carro",
        amount: 1_006_00,
        installment: { paid: 13, total: 36, ends: { year: 2028, month: 9 }, left: 23 * 1_006_00 },
      },
      {
        label: "Aluguel Terno",
        amount: 175_00,
        installment: { paid: 1, total: 2, ends: { year: 2026, month: 11 }, left: 175_00 },
      },
    ]);
  });

  it("finds each destination's fixed line, whatever the case or installment count", () => {
    const fixed = monthFixed(rows, 2026, 10);
    const byLabel = Object.fromEntries(
      monthOutflows(rows, 2026, 10).map((o) => [o.label, fixedOf(o, fixed)?.label ?? null]),
    );
    expect(byLabel).toEqual({
      "Cartão Azul": null,
      "Financiamento Carro 13/36": "Financiamento Carro",
      aluguel: "Aluguel",
      Uniube: null,
      "Aluguel Terno 1/2": "Aluguel Terno",
      Presente: null,
    });
  });

  it("never marks a card bill as fixed, even one named like a fixed line", () => {
    const fixed: Fixed[] = [{ label: "Cartão Azul", amount: cents(3_000_00), installment: null }];
    const card = monthOutflows(rows, 2026, 10).find((o) => o.label === "Cartão Azul");
    expect(card && fixedOf(card, fixed)).toBe(null);
  });

  it("leaves out cards, one-off lines and bills seen only once before", () => {
    const labels = monthFixed(rows, 2026, 10).map((f) => f.label);
    expect(labels).not.toContain("Cartão Azul");
    expect(labels).not.toContain("Presente");
    expect(labels).not.toContain("Uniube");
  });

  it("is empty without history", () => {
    expect(monthFixed(rows, 2026, 7).filter((f) => f.installment === null)).toEqual([]);
  });
});

describe("known cards", () => {
  const rows = ledger("2026-07-01", 123, 10_000_00, {
    "2026-07-10": { saida: cell(300_00, [item(300_00, "Itau", "contas")]) },
    "2026-08-10": { saida: cell(300_00, [item(300_00, "Itau", "contas")]) },
    "2026-10-10": { saida: cell(300_00, [item(300_00, "Itaú", "contas")]) },
  });

  it("treats a line named like a known card as a card, even outside a card section", () => {
    expect(monthFixed(rows, 2026, 10, ["Itau"])).toEqual([]);
    expect(monthOutflows(rows, 2026, 10, ["Itau"])).toEqual([
      {
        label: "Itaú",
        amount: 300_00,
        count: 1,
        kind: "card",
        change: null,
        countBefore: null,
        others: false,
      },
    ]);
  });
});
