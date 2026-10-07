import { checkBalances } from "./balance.ts";
import { type CardConfig, cycleForDueMonth, isCardItem, normalizeName } from "./cards.ts";
import { diffDays, type LocalDate, parts } from "./date.ts";
import type { CellRef, CellValue, Column, Ledger } from "./ledger.ts";
import { add, type Cents } from "./money.ts";

export type HealthIssue =
  | { kind: "missing-date"; date: LocalDate; ref: CellRef }
  | {
      kind: "note-mismatch";
      date: LocalDate;
      column: Column;
      ref: CellRef;
      cell: Cents;
      notes: Cents;
    }
  | { kind: "balance-mismatch"; date: LocalDate; ref: CellRef; sheet: Cents; computed: Cents }
  | { kind: "missing-bill"; date: LocalDate; ref: CellRef; card: string }
  | {
      kind: "unparsed-note";
      date: LocalDate;
      column: Column;
      ref: CellRef;
      lines: readonly string[];
    };

const COLUMNS: readonly Column[] = ["entrada", "saida", "diario"];

const noteIssues = (date: LocalDate, column: Column, cell: CellValue): HealthIssue[] => {
  const out: HealthIssue[] = [];
  if (cell.items.length > 0) {
    const notes = add(...cell.items.map((i) => i.amount));
    if (notes !== cell.amount)
      out.push({ kind: "note-mismatch", date, column, ref: cell.ref, cell: cell.amount, notes });
  }
  if (cell.unparsed.length > 0)
    out.push({ kind: "unparsed-note", date, column, ref: cell.ref, lines: cell.unparsed });
  return out;
};

/** Everything in the sheet the method says should hold but does not. Pure and order-stable. */
export const sheetHealth = (ledger: Ledger): HealthIssue[] => {
  const issues: HealthIssue[] = [];
  for (const row of ledger) {
    if (!row.dateCellOk) issues.push({ kind: "missing-date", date: row.date, ref: row.dateRef });
    for (const column of COLUMNS) issues.push(...noteIssues(row.date, column, row[column]));
  }
  for (const { row, computed } of checkBalances(ledger)) {
    if (row.saldo !== null && row.saldo !== computed)
      issues.push({
        kind: "balance-mismatch",
        date: row.date,
        ref: row.saldoRef,
        sheet: row.saldo,
        computed,
      });
  }
  return issues.sort((a, b) => a.date.localeCompare(b.date));
};

/** Days around the due day where a bill still counts as written (weekends, holidays). */
const BILL_SLACK_DAYS = 3;

/**
 * Card bills already due that the sheet does not carry. Only the latest due bill of each card,
 * and only for cards with a bill in one of the two months before, so a card no longer used stays
 * quiet. A line of R$ 0,00 counts as written.
 */
export const missingBills = (
  ledger: Ledger,
  cards: readonly CardConfig[],
  today: LocalDate,
): HealthIssue[] => {
  const written = (card: CardConfig, due: LocalDate, nonZero: boolean): boolean => {
    const key = normalizeName(card.name);
    return ledger.some(
      (row) =>
        Math.abs(diffDays(due, row.date)) <= BILL_SLACK_DAYS &&
        row.saida.items.some(
          (i) =>
            isCardItem(i) && normalizeName(i.description) === key && (!nonZero || i.amount !== 0),
        ),
    );
  };
  const out: HealthIssue[] = [];
  const { year, month } = parts(today);
  for (const card of cards) {
    let { due } = cycleForDueMonth(card, year, month);
    if (diffDays(due, today) <= 0) due = cycleForDueMonth(card, year, month - 1).due;
    const row = ledger.find((r) => r.date === due);
    if (!row || written(card, due, false)) continue;
    const before = [1, 2].map((back) => {
      const p = parts(due);
      return cycleForDueMonth(card, p.year, p.month - back).due;
    });
    if (!before.some((d) => written(card, d, true))) continue;
    out.push({ kind: "missing-bill", date: due, ref: row.saida.ref, card: card.name });
  }
  return out;
};
