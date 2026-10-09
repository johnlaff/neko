import { billOnSheet, type CardConfig, cycleForDueMonth, normalizeName } from "./cards.ts";
import { diffDays, type LocalDate } from "./date.ts";
import type { Ledger, NoteItem } from "./ledger.ts";
import { add, type Cents, sub, ZERO } from "./money.ts";

/**
 * Open Finance, read-only (specs/003-open-finance). The bank never changes a balance or a bill:
 * these functions only say where the sheet and the bank disagree.
 */

/** A card charge as the bank reports it, already tied to the sheet's card name. */
export interface BankCardLine {
  readonly card: string;
  /** Positive for a charge, negative for a refund or a payment. */
  readonly amount: Cents;
  /** Month of the bill it lands on, `YYYY-MM`. */
  readonly billMonth: string;
  readonly description: string;
  readonly installment: number | null;
  readonly installments: number | null;
}

/** One future bill: what the bank already has on it and what the sheet expects. */
export interface BillCheck {
  readonly card: string;
  readonly due: LocalDate;
  /** Charges the bank already put on this bill, refunds subtracted. */
  readonly bank: Cents;
  /** Of those, the parcels of earlier purchases. */
  readonly parcels: Cents;
  readonly sheet: Cents;
  /** bank − sheet: positive means the sheet expects less than is already committed. */
  readonly gap: Cents;
}

/**
 * A bill the bank already closed: its total is final, though Open Finance may leave a few of its
 * lines out. `cards` are the sheet names of every card on that bank account (holder and
 * additional), so the check compares the whole bill at once.
 */
export interface ClosedBill {
  readonly cards: readonly string[];
  /** Due month, `YYYY-MM`. */
  readonly billMonth: string;
  readonly total: Cents;
}

/** "Bradesco João" and "Bradesco Gio" read as "Bradesco"; names with nothing in common are joined. */
const sharedName = (names: readonly string[]): string => {
  const words = names.map((n) => n.split(/\s+/));
  const first = words[0] ?? [];
  let k = 0;
  while (k < first.length && words.every((w) => w[k] === first[k])) k++;
  return k > 0 ? first.slice(0, k).join(" ") : names.join(" + ");
};

/** A card account also shows the payment of the previous bill; that is not a charge. */
const PAYMENT = /\bpagamento|\bpagto|\bpgto/i;

const nextMonth = (month: string, n: number): string => {
  const [y = 0, m = 1] = month.split("-").map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
};

/** The purchase behind a parcel: banks often write "PARC 02/04" in the text, so that goes. */
const purchaseKey = (l: BankCardLine): string =>
  [
    normalizeName(l.card),
    l.description
      .replace(/\bparc(ela)?\b|\d{1,2}\s*\/\s*\d{1,2}/gi, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .toLowerCase(),
    l.amount,
    l.installments,
  ].join("|");

/**
 * The bank lists only the parcels already on a bill; the rest of each purchase is already owed.
 * Parcel n of N on month M puts n+1..N on the months after, unless the bank already lists them.
 * Two purchases with the same text, parcel value and count read as one.
 */
const withFutureParcels = (lines: readonly BankCardLine[]): BankCardLine[] => {
  const seen = new Set(
    lines.filter((l) => l.installment !== null).map((l) => `${purchaseKey(l)}|${l.installment}`),
  );
  const out = [...lines];
  for (const l of lines) {
    const { installment: n, installments: total } = l;
    if (n === null || total === null || n >= total) continue;
    for (let k = n + 1; k <= total; k++) {
      const key = `${purchaseKey(l)}|${k}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...l, installment: k, billMonth: nextMonth(l.billMonth, k - n) });
    }
  }
  return out;
};

/**
 * Each bill still to come, per card the sheet knows: the bank's sum, with the parcels still owed,
 * against the sheet's line on the due day. A bill already due is history and stays out, and so
 * does one past the sheet's last tab.
 */
export const billChecks = (
  ledger: Ledger,
  cards: readonly CardConfig[],
  lines: readonly BankCardLine[],
  today: LocalDate,
  closed: readonly ClosedBill[] = [],
): BillCheck[] => {
  const byCard = new Map(cards.map((c) => [normalizeName(c.name), c]));
  const groups = new Map<string, { card: CardConfig; month: string; lines: BankCardLine[] }>();
  for (const l of withFutureParcels(lines)) {
    const card = byCard.get(normalizeName(l.card));
    if (!card || (l.amount < 0 && PAYMENT.test(l.description))) continue;
    const key = `${normalizeName(card.name)}|${l.billMonth}`;
    const g = groups.get(key) ?? { card, month: l.billMonth, lines: [] };
    g.lines.push(l);
    groups.set(key, g);
  }
  const out: BillCheck[] = [];
  // A closed bill: the bank's total against every sheet line of that account on its due day.
  for (const bill of closed) {
    const own = bill.cards.flatMap((n) => byCard.get(normalizeName(n)) ?? []);
    const [first] = own;
    const [y, m] = bill.billMonth.split("-").map(Number);
    if (!first || !y || !m) continue;
    const { due } = cycleForDueMonth(first, y, m);
    const ls = own.flatMap((c) => {
      const key = `${normalizeName(c.name)}|${bill.billMonth}`;
      const g = groups.get(key);
      groups.delete(key);
      return g?.lines ?? [];
    });
    if (diffDays(today, due) <= 0) continue;
    const sheets = own.map((c) => billOnSheet(ledger, c, due));
    if (sheets.every((v) => v === null)) continue;
    const sheet = add(ZERO, ...sheets.map((v) => v ?? ZERO));
    const parcels = add(ZERO, ...ls.filter((l) => (l.installments ?? 1) > 1).map((l) => l.amount));
    const card = sharedName(own.map((c) => c.name));
    out.push({ card, due, bank: bill.total, parcels, sheet, gap: sub(bill.total, sheet) });
  }
  for (const { card, month, lines: ls } of groups.values()) {
    const [y, m] = month.split("-").map(Number);
    if (!y || !m) continue;
    const { due } = cycleForDueMonth(card, y, m);
    if (diffDays(today, due) <= 0) continue;
    const bank = add(ZERO, ...ls.map((l) => l.amount));
    const parcels = add(ZERO, ...ls.filter((l) => (l.installments ?? 1) > 1).map((l) => l.amount));
    const sheet = billOnSheet(ledger, card, due);
    if (sheet === null) continue;
    out.push({ card: card.name, due, bank, parcels, sheet, gap: sub(bank, sheet) });
  }
  return out.sort((a, b) => a.due.localeCompare(b.due) || a.card.localeCompare(b.card));
};

/** A checking-account movement: positive comes in, negative goes out. */
export interface BankMovement {
  readonly date: LocalDate;
  readonly amount: Cents;
  readonly description: string;
}

/** How far apart the bank's date and the sheet's day may be, as in Actual Budget's matching. */
export const MATCH_DAYS = 7;

/** The sheet's lines of one column; a cell without a note counts as one line of its total. */
const sheetLines = (cell: { amount: Cents; items: readonly NoteItem[] }): Cents[] =>
  cell.items.length > 0 ? cell.items.map((i) => i.amount) : cell.amount === 0 ? [] : [cell.amount];

/**
 * Movements up to today with no sheet line of the same amount, same direction, within
 * MATCH_DAYS. Each sheet line answers for one movement only, the closest in date first.
 */
export const unmatchedMovements = (
  ledger: Ledger,
  movements: readonly BankMovement[],
  today: LocalDate,
): BankMovement[] => {
  const pool = ledger.flatMap((r) => [
    ...sheetLines(r.entrada).map((amount) => ({ date: r.date, amount, used: false })),
    ...sheetLines(r.saida).map((amount) => ({
      date: r.date,
      amount: sub(ZERO, amount),
      used: false,
    })),
  ]);
  const candidates = movements
    .filter((m) => diffDays(m.date, today) >= 0 && m.amount !== 0)
    .flatMap((m) =>
      pool
        .filter((p) => p.amount === m.amount && Math.abs(diffDays(p.date, m.date)) <= MATCH_DAYS)
        .map((p) => ({ m, p, distance: Math.abs(diffDays(p.date, m.date)) })),
    )
    .sort((a, b) => a.distance - b.distance);
  const matched = new Set<BankMovement>();
  for (const { m, p } of candidates) {
    if (matched.has(m) || p.used) continue;
    p.used = true;
    matched.add(m);
  }
  return movements
    .filter((m) => diffDays(m.date, today) >= 0 && m.amount !== 0 && !matched.has(m))
    .sort((a, b) => a.date.localeCompare(b.date));
};
