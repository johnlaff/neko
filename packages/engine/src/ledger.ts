import type { LocalDate } from "./date.ts";
import type { Cents } from "./money.ts";

/** Which column of the day row a value came from. */
export type Column = "entrada" | "saida" | "diario";

/** One `R$ 12,34 - Descrição` line of a cell note, with the section header above it, if any. */
export interface NoteItem {
  readonly amount: Cents;
  readonly description: string;
  /** Normalized header such as `cartoes`, `faturas`, `contas`, `reserva`; null if none. */
  readonly section: string | null;
}

export interface CellRef {
  readonly tab: string;
  /** A1 address, e.g. `BC15`. */
  readonly a1: string;
}

export interface CellValue {
  readonly amount: Cents;
  readonly items: readonly NoteItem[];
  /** Note lines that did not match the grammar, kept verbatim for the health report. */
  readonly unparsed: readonly string[];
  readonly ref: CellRef;
}

/** One day row of the sheet, already validated by the reader. */
export interface DayRow {
  readonly date: LocalDate;
  readonly entrada: CellValue;
  readonly saida: CellValue;
  readonly diario: CellValue;
  /** The Saldo column as the sheet computed it; null when the cell is empty. */
  readonly saldo: Cents | null;
  readonly saldoRef: CellRef;
  /** False when the Data cell is empty or holds a different day number. */
  readonly dateCellOk: boolean;
  readonly dateRef: CellRef;
}

/** Days in chronological order with no gaps. */
export type Ledger = readonly DayRow[];

/**
 * The note line Neko writes on a future day's Diário when the owner turns the Diário previsto on
 * (specs/005-lancamentos, Fase 3): `R$ 45,00 - Previsto`. A forecast, never something spent.
 */
export const FORECAST = "Previsto";

export const isForecastItem = (i: NoteItem): boolean =>
  i.section === null && i.description.trim().toLowerCase() === FORECAST.toLowerCase();

/** The part of a cell that is forecast: the sum of its `Previsto` lines. */
export const forecastIn = (cell: Pick<CellValue, "items">): Cents =>
  cell.items.reduce((sum, i) => (isForecastItem(i) ? sum + i.amount : sum), 0) as Cents;
