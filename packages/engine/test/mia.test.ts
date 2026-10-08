import { describe, expect, it } from "vitest";
import {
  type CardConfig,
  cents,
  checkAnswer,
  localDate,
  MIA_TOOLS,
  project,
  type RefValue,
  refBook,
  runMiaTool,
} from "../src/index.ts";
import { cell, item, ledger } from "./builders.ts";

const visa: CardConfig = { name: "Visa", closingDay: 3, dueDay: 10, closingEstimated: false };
// Invented sheet: salary on the 5th, rent on the 10th, market lines on the card's bill.
const days = ledger("2026-08-01", 153, 5_000_00, {
  "2026-08-05": { entrada: cell(6_000_00, [item(6_000_00, "Salário", null)]) },
  "2026-08-10": {
    saida: cell(2_300_00, [item(1_500_00, "Aluguel", "contas"), item(800_00, "Visa")]),
  },
  "2026-09-05": { entrada: cell(6_000_00, [item(6_000_00, "Salário", null)]) },
  "2026-09-10": {
    saida: cell(2_500_00, [item(1_500_00, "Aluguel", "contas"), item(1_000_00, "Visa")]),
  },
  "2026-09-20": { saida: cell(300_00, [item(300_00, "Mercado Bom Preço", "contas")]) },
  "2026-10-20": { saida: cell(150_00, [item(150_00, "Mercado Bom Preço", "contas")]) },
});
const p = project(days, localDate("2026-10-08"), {
  dailyForecast: cents(50_00),
  usualCard: "Visa",
  cycleBudget: null,
  cards: [visa],
  othersCards: [],
});

describe("mia tools: the engine computes, the model only points", () => {
  it("lists one tool per question kind, the answer tool apart", () => {
    expect(MIA_TOOLS).toEqual([
      "periodo",
      "hoje",
      "mes",
      "comparar_meses",
      "gasto_com",
      "faturas",
      "reserva",
    ]);
  });

  it("gives every amount as a reference and keeps the cents beside it", () => {
    const book = refBook();
    const out = runMiaTool(p, "mes", { mes: "2026-09" }, book) as Record<string, unknown>;
    expect(out.entradas).toEqual({ ref: "v1", cents: 6_000_00, tipo: "total" });
    expect(book.values().v1).toEqual({
      tipo: "total",
      rotulo: "Entradas de 2026-09",
      tela: "mes",
      mes: "2026-09",
      cents: 6_000_00,
    });
    expect(JSON.stringify(out)).not.toMatch(/"cents":\d+,"ref"|R\$/);
  });

  it("compares two months with the difference and the percent already done", () => {
    const book = refBook();
    const out = runMiaTool(p, "comparar_meses", { a: "2026-08", b: "2026-09" }, book) as {
      saidas: {
        a: { cents: number };
        b: { cents: number };
        diferenca: { cents: number; tipo: string };
        direcao: string;
        variacao_pct: { pct: number; tipo: string };
      };
    };
    expect(out.saidas.a.cents).toBe(2_300_00);
    expect(out.saidas.b.cents).toBe(2_800_00);
    expect(out.saidas.diferenca).toMatchObject({ cents: 500_00, tipo: "diferenca" });
    expect(out.saidas.direcao).toBe("subiu");
    expect(out.saidas.variacao_pct).toMatchObject({ pct: 22, tipo: "percentual" });
  });

  it("turns a period in words into months, from the sheet's today", () => {
    const book = refBook();
    expect(runMiaTool(p, "periodo", { expressao: "mes_passado" }, book)).toEqual({
      hoje: "2026-10-08",
      de: "2026-09",
      ate: "2026-09",
    });
    expect(runMiaTool(p, "periodo", { expressao: "ultimos_3_meses" }, book)).toMatchObject({
      de: "2026-07",
      ate: "2026-09",
    });
    expect(runMiaTool(p, "periodo", { expressao: "ano_passado" }, book)).toMatchObject({
      de: "2025-01",
      ate: "2025-12",
    });
    expect(runMiaTool(p, "periodo", { expressao: "semana" }, book)).toMatchObject({
      erro: expect.any(String),
    });
  });

  it("finds what was spent on a name, month by month, with the total", () => {
    const book = refBook();
    const out = runMiaTool(
      p,
      "gasto_com",
      { termo: "mercado", de: "2026-08", ate: "2026-10" },
      book,
    ) as { total: { cents: number }; por_mes: { mes: string }[] };
    expect(out.total.cents).toBe(450_00);
    expect(out.por_mes.map((m) => m.mes)).toEqual(["2026-09", "2026-10"]);
  });

  it("answers an unknown month or a bad input with an error the model can read", () => {
    const book = refBook();
    expect(runMiaTool(p, "mes", { mes: "2019-01" }, book)).toEqual({
      erro: "A planilha não tem esse mês.",
    });
    expect(runMiaTool(p, "mes", { mes: "setembro" }, book)).toMatchObject({
      erro: expect.any(String),
    });
    expect(runMiaTool(p, "apagar", {}, book)).toMatchObject({ erro: expect.any(String) });
  });

  it("continues the numbering of earlier turns", () => {
    const meta = { tipo: "total", rotulo: "x", tela: "mes" } as const;
    const book = refBook({ v1: { ...meta, cents: 1 }, v2: { ...meta, cents: 2 } });
    const out = runMiaTool(p, "hoje", {}, book) as { saldo_hoje: { ref: string } };
    expect(out.saldo_hoje.ref).toBe("v3");
  });
});

describe("checkAnswer: no money or math written by the model", () => {
  const known: Record<string, RefValue> = {
    v1: { tipo: "total", rotulo: "Mercado", tela: "mes", cents: 300_00 },
    v2: { tipo: "total", rotulo: "Feira", tela: "mes", cents: 100_00 },
    v3: { tipo: "diferenca", rotulo: "Saídas", tela: "mes", cents: 500_00 },
  };
  it("accepts text with references, dates and plain counts", () => {
    expect(checkAnswer("Em setembro você gastou {{v1}} com mercado, em 2 compras.", known)).toEqual(
      {
        ok: true,
      },
    );
  });
  it.each([
    ["Você gastou R$ 300 com mercado.", "dinheiro"],
    ["Foram 1.234,56 no mês.", "dinheiro"],
    ["Foram 300.50 no mês.", "dinheiro"],
    ["Sobrou {{v9}}.", "referência"],
    ["Somando {{v1}} e {{v2}}, dá mais.", "conta"],
    ["Mercado subiu: {{v1}} contra {{v2}}.", "comparou"],
    ["As compras caíram para {{v2}}.", "comparou"],
  ])("refuses %s", (text, reason) => {
    const r = checkAnswer(text, known);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(reason);
  });
  it("accepts a comparison that uses the engine's difference", () => {
    expect(checkAnswer("As saídas subiram {{v3}} de agosto para setembro.", known)).toEqual({
      ok: true,
    });
  });
});
