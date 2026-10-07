import {
  type CellValue,
  cents,
  type DayRow,
  daysInMonth,
  fromReais,
  type LocalDate,
  ymd,
} from "@neko/engine";
import { a1 } from "./a1.ts";
import { type CeilingNote, parseCeilingNote, parseNote } from "./note.ts";
import { parseNumber } from "./number.ts";

/** The slice of the Sheets API `GridData` the reader asks for (see `SHEET_FIELDS`). */
export interface ApiCell {
  formattedValue?: string;
  effectiveValue?: { numberValue?: number; stringValue?: string; boolValue?: boolean };
  userEnteredValue?: { formulaValue?: string; numberValue?: number; stringValue?: string };
  note?: string;
}
export interface ApiGrid {
  rowData?: { values?: ApiCell[] }[];
}

/**
 * Where everything lives in a year tab. Explicit on purpose: if the sheet's shape changes, the
 * reader stops with a clear error instead of guessing.
 */
export const SHEET_MAP = {
  monthNameRow: 0,
  headerRow: 1,
  firstDayRow: 2,
  blockWidth: 6,
  offsets: { data: 0, entrada: 1, saida: 2, diario: 3, saldo: 4 },
  headers: ["DATA", "ENTRADA", "SAIDA", "DIARIO", "SALDO"],
  months: [
    "JANEIRO",
    "FEVEREIRO",
    "MARCO",
    "ABRIL",
    "MAIO",
    "JUNHO",
    "JULHO",
    "AGOSTO",
    "SETEMBRO",
    "OUTUBRO",
    "NOVEMBRO",
    "DEZEMBRO",
  ],
} as const;

/** Rows 1–33 and the 12 blocks of 6 columns: `A1:BS33`. */
export const YEAR_TAB_RANGE = "A1:BS33";

export class SheetStructureError extends Error {
  override name = "SheetStructureError";
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .trim();

const cellAt = (grid: ApiGrid, row: number, col: number): ApiCell | undefined =>
  grid.rowData?.[row]?.values?.[col];

const text = (cell: ApiCell | undefined): string =>
  cell?.formattedValue ?? cell?.effectiveValue?.stringValue ?? "";

const amountOf = (cell: ApiCell | undefined): number => {
  const n = cell?.effectiveValue?.numberValue;
  if (n !== undefined) return fromReais(n);
  const parsed = parseNumber(text(cell));
  return parsed ?? 0;
};

export const validateYearTab = (grid: ApiGrid, tab: string): void => {
  SHEET_MAP.months.forEach((name, m) => {
    const col = m * SHEET_MAP.blockWidth;
    const found = fold(text(cellAt(grid, SHEET_MAP.monthNameRow, col)));
    if (!found.startsWith(name))
      throw new SheetStructureError(
        `aba ${tab}: esperava ${name} em ${a1(SHEET_MAP.monthNameRow, col)}, achei "${found}"`,
      );
    SHEET_MAP.headers.forEach((header, i) => {
      const got = fold(text(cellAt(grid, SHEET_MAP.headerRow, col + i)));
      if (got !== header)
        throw new SheetStructureError(
          `aba ${tab}: esperava o cabeçalho ${header} em ${a1(SHEET_MAP.headerRow, col + i)}, achei "${got}"`,
        );
    });
  });
};

export interface YearTab {
  readonly rows: DayRow[];
  /** Latest valid "previsão do diário" note in the tab, with the month it sits in. */
  readonly ceiling: { readonly note: CeilingNote; readonly date: LocalDate } | null;
}

/** Reads one `YYYY` tab into day rows, Jan 1 to Dec 31, after checking its structure. */
export const readYearTab = (grid: ApiGrid, tab: string, year: number): YearTab => {
  validateYearTab(grid, tab);
  const rows: DayRow[] = [];
  let ceiling: YearTab["ceiling"] = null;
  for (let m = 0; m < 12; m++) {
    const base = m * SHEET_MAP.blockWidth;
    for (let day = 1; day <= daysInMonth(year, m + 1); day++) {
      const r = SHEET_MAP.firstDayRow + day - 1;
      const date = ymd(year, m + 1, day);
      const cell = (col: number): CellValue => {
        const c = cellAt(grid, r, base + col);
        const note = parseNote(c?.note);
        return {
          amount: cents(amountOf(c)),
          items: note.items,
          unparsed: note.unparsed,
          ref: { tab, a1: a1(r, base + col) },
        };
      };
      const ceilingHere = parseCeilingNote(cellAt(grid, r, base + SHEET_MAP.offsets.diario)?.note);
      if (ceilingHere) ceiling = { note: ceilingHere, date };
      const dateCell = cellAt(grid, r, base + SHEET_MAP.offsets.data);
      const saldoCell = cellAt(grid, r, base + SHEET_MAP.offsets.saldo);
      const saldoText = text(saldoCell);
      const rawDay = dateCell?.effectiveValue?.numberValue;
      const dayNumber =
        rawDay !== undefined && rawDay <= 31 ? rawDay : Number(/^\d+/.exec(text(dateCell))?.[0]);
      rows.push({
        date,
        entrada: cell(SHEET_MAP.offsets.entrada),
        saida: cell(SHEET_MAP.offsets.saida),
        // The "previsão do diário" note is a plan, not a breakdown of the cell.
        diario: ceilingHere
          ? { ...cell(SHEET_MAP.offsets.diario), items: [], unparsed: [] }
          : cell(SHEET_MAP.offsets.diario),
        saldo:
          saldoCell?.effectiveValue?.numberValue !== undefined || saldoText !== ""
            ? cents(amountOf(saldoCell))
            : null,
        saldoRef: { tab, a1: a1(r, base + SHEET_MAP.offsets.saldo) },
        dateCellOk: dayNumber === day,
        dateRef: { tab, a1: a1(r, base + SHEET_MAP.offsets.data) },
      });
    }
  }
  return { rows, ceiling };
};
