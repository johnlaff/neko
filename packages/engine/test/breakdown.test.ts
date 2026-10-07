import { describe, expect, it } from "vitest";
import { monthOutflows, splitInstallment } from "../src/index.ts";
import { cell, item, ledger } from "./builders.ts";

describe("monthOutflows", () => {
  const rows = ledger("2026-09-28", 40, 10_000_00, {
    "2026-09-30": { saida: cell(99_00, [item(99_00, "Vivo", null)]) },
    "2026-10-02": {
      saida: cell(573_28, [item(500_00, "Visa"), item(73_28, "Vivo", "contas")]),
    },
    "2026-10-15": { saida: cell(80_00, [item(80_00, "vivo ", "contas")]) },
    "2026-10-20": { saida: cell(40_00) },
    "2026-10-21": { saida: cell(60_00, [item(25_00, "Feira", null)]) },
    "2026-10-22": { saida: cell(0, [item(0, "Itau")]) },
  });

  it("groups the month's saídas by description, largest first, with last month's amount", () => {
    expect(monthOutflows(rows, 2026, 10)).toEqual([
      {
        label: "Visa",
        amount: 500_00,
        count: 1,
        kind: "card",
        change: null,
        countBefore: null,
        others: false,
      },
      {
        label: "Vivo",
        amount: 153_28,
        count: 2,
        kind: "bill",
        change: 153_28 - 99_00,
        countBefore: 1,
        others: false,
      },
      {
        label: "Sem detalhe",
        amount: 75_00,
        count: 2,
        kind: "bill",
        change: null,
        countBefore: null,
        others: false,
      },
      {
        label: "Feira",
        amount: 25_00,
        count: 1,
        kind: "bill",
        change: null,
        countBefore: null,
        others: false,
      },
    ]);
  });

  it("marks the bills of someone else's card", () => {
    const verde = ledger("2026-10-01", 10, 10_000_00, {
      "2026-10-02": { saida: cell(700_00, [item(500_00, "Visa"), item(200_00, "verde")]) },
    });
    const out = monthOutflows(verde, 2026, 10, ["Verde"], ["Verde "]);
    expect(out.map((o) => [o.label, o.kind, o.others])).toEqual([
      ["Visa", "card", false],
      ["verde", "card", true],
    ]);
  });

  it("adds up to the month's Saída total", () => {
    const total = monthOutflows(rows, 2026, 10).reduce((s, o) => s + o.amount, 0);
    expect(total).toBe(500_00 + 73_28 + 80_00 + 40_00 + 60_00);
  });

  it("is empty for a month without saídas", () => {
    expect(monthOutflows(rows, 2026, 12)).toEqual([]);
  });

  it("compares an installment with the previous one", () => {
    const car = ledger("2026-09-01", 60, 10_000_00, {
      "2026-09-05": { saida: cell(1_006_00, [item(1_006_00, "Carro 12/36", "contas")]) },
      "2026-10-05": { saida: cell(1_006_00, [item(1_006_00, "Carro 13/36", "contas")]) },
    });
    expect(monthOutflows(car, 2026, 10)).toEqual([
      {
        label: "Carro 13/36",
        amount: 1_006_00,
        count: 1,
        kind: "bill",
        change: 0,
        countBefore: 1,
        others: false,
      },
    ]);
  });
});

describe("splitInstallment", () => {
  it("separates an n/N suffix from the name", () => {
    expect(splitInstallment("Financiamento Carro 13/36")).toEqual({
      name: "Financiamento Carro",
      part: "13/36",
    });
    expect(splitInstallment("Tênis 2 / 5")).toEqual({ name: "Tênis", part: "2/5" });
    expect(splitInstallment("Aluguel")).toEqual({ name: "Aluguel", part: null });
  });
});
