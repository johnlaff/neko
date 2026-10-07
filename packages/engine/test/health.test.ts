import { describe, expect, it } from "vitest";
import { checkBalances, sheetHealth } from "../src/index.ts";
import { cell, item, ledger } from "./builders.ts";

describe("balance chain", () => {
  it("recomputes saldo = anterior + entrada − (saída + diário)", () => {
    const l = ledger("2026-10-01", 3, 1000_00, {
      "2026-10-02": { entrada: cell(500_00), saida: cell(200_00), diario: cell(50_00) },
    });
    expect(checkBalances(l).map((c) => c.computed)).toEqual([1000_00, 1250_00, 1250_00]);
  });
});

describe("sheet health", () => {
  it("is empty for a consistent sheet", () => {
    expect(sheetHealth(ledger("2026-10-01", 31, 100_00))).toEqual([]);
  });
  it("flags an empty date cell (the real Oct 13 case)", () => {
    const issues = sheetHealth(
      ledger("2026-10-01", 31, 0, { "2026-10-13": { dateCellOk: false } }),
    );
    expect(issues).toMatchObject([{ kind: "missing-date", date: "2026-10-13" }]);
  });
  it("flags a note that does not add up to its cell", () => {
    const issues = sheetHealth(
      ledger("2026-10-01", 2, 0, {
        "2026-10-02": { saida: cell(100_00, [item(60_00, "A"), item(60_00, "B")]) },
      }),
    );
    expect(issues).toMatchObject([{ kind: "note-mismatch", cell: 100_00, notes: 120_00 }]);
  });
  it("reports a wrong saldo once and re-anchors, instead of cascading", () => {
    const l = ledger("2026-10-01", 5, 1000_00, { "2026-10-03": { saldo: 999_00 } });
    const issues = sheetHealth(l);
    expect(issues).toHaveLength(2); // day 3 differs from the chain, and day 4 differs from day 3's saldo
    expect(issues[0]).toMatchObject({
      kind: "balance-mismatch",
      date: "2026-10-03",
      sheet: 999_00,
      computed: 1000_00,
    });
  });
});
