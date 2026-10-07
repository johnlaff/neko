import { describe, expect, it } from "vitest";
import {
  type ApiCell,
  type ApiGrid,
  a1,
  columnLetters,
  readSpreadsheet,
  SheetStructureError,
} from "../src/index.ts";

const MONTHS = [
  "JANEIRO",
  "FEVEREIRO",
  "MARÇO",
  "ABRIL",
  "MAIO",
  "JUNHO",
  "JULHO",
  "AGOSTO",
  "SETEMBRO",
  "OUTUBRO",
  "NOVEMBRO",
  "DEZEMBRO",
];

/** A year tab shaped like the real one: 12 blocks of 6 columns, days in rows 3–33. */
const yearGrid = (
  edit: (set: (a1addr: string, cell: ApiCell) => void) => void = () => {},
): ApiGrid => {
  const rows: ApiCell[][] = Array.from({ length: 33 }, () =>
    Array.from({ length: 71 }, () => ({})),
  );
  MONTHS.forEach((m, i) => {
    const c = i * 6;
    (rows[0] as ApiCell[])[c] = { formattedValue: m };
    ["Data", "Entrada", "Saída", "Diário", "Saldo"].forEach((h, k) => {
      (rows[1] as ApiCell[])[c + k] = { formattedValue: h };
    });
    for (let d = 1; d <= 31; d++)
      (rows[d + 1] as ApiCell[])[c] = {
        formattedValue: String(d),
        effectiveValue: { numberValue: d },
      };
  });
  edit((addr, cell) => {
    const m = /^([A-Z]+)(\d+)$/.exec(addr);
    if (!m) throw new Error(addr);
    const col = [...(m[1] ?? "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    (rows[Number(m[2]) - 1] as ApiCell[])[col] = cell;
  });
  return { rowData: rows.map((values) => ({ values })) };
};

const doc = (...tabs: [string, ApiGrid][]) => ({
  sheets: tabs.map(([title, g]) => ({ properties: { title }, data: [g] })),
});

describe("A1", () => {
  it("maps columns like the real October block", () => {
    expect(columnLetters(54)).toBe("BC");
    expect(a1(14, 54)).toBe("BC15");
    expect(columnLetters(70)).toBe("BS");
  });
});

describe("readSpreadsheet", () => {
  it("reads values, notes and the empty Oct 13 date cell", () => {
    const g = yearGrid((set) => {
      set("BC15", {}); // Oct 13 without its date, as in the real sheet
      set("BE6", {
        effectiveValue: { numberValue: 1030.49 },
        userEnteredValue: { formulaValue: "=SUM(250.38+780.11)" },
        note: "CARTÕES:\nR$ 250,38 - Itau\nR$ 780,11 - Nubank",
      });
      set("BG6", { effectiveValue: { numberValue: 5000 } });
    });
    const { ledger, years } = readSpreadsheet(doc(["2026", g], ["Economia", {}]));
    expect(years).toEqual([2026]);
    expect(ledger).toHaveLength(365);
    const oct4 = ledger.find((r) => r.date === "2026-10-04");
    expect(oct4?.saida.amount).toBe(103049);
    expect(oct4?.saida.items.map((i) => i.description)).toEqual(["Itau", "Nubank"]);
    expect(oct4?.saida.ref).toEqual({ tab: "2026", a1: "BE6" });
    expect(oct4?.saldo).toBe(500000);
    const oct13 = ledger.find((r) => r.date === "2026-10-13");
    expect(oct13).toMatchObject({ dateCellOk: false, dateRef: { a1: "BC15" } });
  });

  it("skips day rows that do not exist in the month (Feb 30)", () => {
    const { ledger } = readSpreadsheet(doc(["2026", yearGrid()]));
    expect(ledger.filter((r) => r.date.startsWith("2026-02"))).toHaveLength(28);
  });

  it("stops with a clear error when a month block moved", () => {
    const g = yearGrid((set) => set("BC1", { formattedValue: "NOVEMBRO" }));
    expect(() => readSpreadsheet(doc(["2026", g]))).toThrow(SheetStructureError);
    expect(() => readSpreadsheet(doc(["2026", g]))).toThrow(/OUTUBRO em BC1/);
  });

  it("finds the diário plan note and keeps it out of the cell breakdown", () => {
    const g = yearGrid((set) => set("BF3", { note: "R$ 3100,00 / 31 Dias = R$ 100,00" }));
    const { ledger, ceiling } = readSpreadsheet(doc(["2026", g]));
    expect(ceiling).toEqual({ perDay: 10000, date: "2026-10-01" });
    expect(ledger.find((r) => r.date === "2026-10-01")?.diario.items).toEqual([]);
  });

  it("chains years in order", () => {
    const { ledger } = readSpreadsheet(doc(["2026", yearGrid()], ["2025", yearGrid()]));
    expect(ledger[0]?.date).toBe("2025-01-01");
    expect(ledger.at(-1)?.date).toBe("2026-12-31");
  });
});
