import { existsSync, readFileSync } from "node:fs";
import { cents, daysInMonth, ymd } from "@neko/engine";
import {
  type ApiCell,
  type ApiSpreadsheet,
  checkCell,
  planCellEdit,
  SHEET_MAP,
} from "@neko/sheet-reader";
import { describe, expect, it } from "vitest";

/**
 * Dry run of the writer on the owner's real sheet (specs/005-lancamentos, Fase 0): for every
 * Entrada, Saída and Diário cell, plan the edits an entry could make and prove the plan is sound,
 * without writing anything. The copy lives outside Git; point NEKO_REAL_SHEET at it. Cells the
 * writer would refuse before NEKO_REAL_EDITABLE_FROM (default: start of the latest year with
 * history) are only listed; from that date on there must be none.
 */
const path = process.env.NEKO_REAL_SHEET ?? "";
const available = path !== "" && existsSync(path);

interface Seen {
  readonly date: string;
  readonly a1: string;
  readonly column: string;
  readonly cell: ApiCell | undefined;
}

const cellsOf = (doc: ApiSpreadsheet): Seen[] => {
  const out: Seen[] = [];
  for (const sheet of doc.sheets ?? []) {
    const title = sheet.properties?.title ?? "";
    if (!/^\d{4}$/.test(title)) continue;
    const year = Number(title);
    const rows = sheet.data?.[0]?.rowData ?? [];
    for (let m = 0; m < 12; m++)
      for (let day = 1; day <= daysInMonth(year, m + 1); day++) {
        const r = SHEET_MAP.firstDayRow + day - 1;
        for (const column of ["entrada", "saida", "diario"] as const) {
          const c = m * SHEET_MAP.blockWidth + SHEET_MAP.offsets[column];
          let letters = "";
          for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26))
            letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
          out.push({
            date: ymd(year, m + 1, day),
            a1: `${title}!${letters}${r + 1}`,
            column,
            cell: rows[r]?.values?.[c],
          });
        }
      }
  }
  return out;
};

describe.runIf(available)("writer dry run on the real sheet", () => {
  const doc = available ? (JSON.parse(readFileSync(path, "utf8")) as ApiSpreadsheet) : {};
  const cells = cellsOf(doc);
  const years = [...new Set(cells.map((c) => c.date.slice(0, 4)))].sort();
  const from = process.env.NEKO_REAL_EDITABLE_FROM ?? `${years.at(-2) ?? years[0]}-01-01`;

  it("understands every cell an entry could land on from the editable date on", () => {
    const refused = cells
      .map((c) => ({ ...c, check: checkCell(c.cell) }))
      .filter((c) => !c.check.ok);
    const old = refused.filter((c) => c.date < from);
    if (old.length > 0)
      console.info(
        `${old.length} cells before ${from} the writer would refuse:\n` +
          old.map((c) => `  ${c.a1} ${c.date}: ${c.check.ok ? "" : c.check.reason}`).join("\n"),
      );
    expect(
      refused
        .filter((c) => c.date >= from)
        .map((c) => `${c.a1}: ${c.check.ok ? "" : c.check.reason}`),
    ).toEqual([]);
  });

  it("plans a sound edit for every understood cell, for every kind of entry", () => {
    let planned = 0;
    for (const c of cells) {
      if (!checkCell(c.cell).ok) continue;
      const sections =
        c.column === "saida"
          ? (["contas", "investimento", "reserva", null] as const)
          : ([null] as const);
      for (const section of sections) {
        const p = planCellEdit(c.cell, {
          amount: cents(1),
          description: "Teste",
          section,
          target: "line",
        });
        expect(p.ok, `${c.a1} ${section}`).toBe(true);
        planned++;
      }
      if (c.column === "saida") {
        // Raise every card line already on the bill, and a card that is not there yet.
        const names = (c.cell?.note ?? "")
          .split("\n")
          .map((l) => /^\s*R\$[^-]*-\s*(.+)$/.exec(l)?.[1]?.trim())
          .filter((x): x is string => x !== undefined);
        for (const description of [...names, "Cartão Novo de Teste"]) {
          const p = planCellEdit(c.cell, {
            amount: cents(1),
            description,
            section: "cartoes",
            target: "card",
          });
          // A note may list the same name twice (e.g. once in CONTAS, once in CARTÕES): refusing
          // is fine, a wrong edit is not, and planCellEdit throws on any inconsistent result.
          if (p.ok) planned++;
        }
      }
    }
    expect(planned).toBeGreaterThan(0);
  });
});
