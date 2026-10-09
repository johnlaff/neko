import { billOnSheet, type CardConfig, cycleForDueMonth, normalizeName } from "./cards.ts";
import { diffDays, type LocalDate } from "./date.ts";
import type { Column, Ledger, NoteItem } from "./ledger.ts";
import { add, type Cents, cents, sub, ZERO } from "./money.ts";

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

/** A bill the bank already closed, with its final total. */
export interface ClosedBill {
  readonly card: string;
  /** Due month, `YYYY-MM`. */
  readonly billMonth: string;
  readonly total: Cents;
}

/** A card account also shows the payment of the previous bill; that is not a charge. */
const PAYMENT = /\bpagamento|\bpagto|\bpgto/i;

const nextMonth = (month: string, n: number): string => {
  const [y = 0, m = 1] = month.split("-").map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
};

/** The purchase behind a parcel: banks often write "PARC 02/04" in the text, so that goes. */
const purchaseText = (l: BankCardLine): string =>
  l.description
    .replace(/\bparc(ela)?\b|\d{1,2}\s*\/\s*\d{1,2}/gi, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();

/**
 * Two parcels of the same purchase: same card, count and number, value within a cent per parcel
 * (the bank puts the rounding on the first one: 33,63 then 33,61), and one text starting the other
 * (it lists future parcels with a shorter text, "MERCADOLIVRE*MERC" for "MERCADOLIVRE*MERCADOLI").
 */
const samePurchase = (a: BankCardLine, b: BankCardLine): boolean => {
  if (normalizeName(a.card) !== normalizeName(b.card)) return false;
  if (a.installments !== b.installments || a.installment !== b.installment) return false;
  if (Math.abs(a.amount - b.amount) > Math.max(1, a.installments ?? 1)) return false;
  const [x, y] = [purchaseText(a), purchaseText(b)];
  return x.startsWith(y) || y.startsWith(x);
};

/**
 * The bank lists only the parcels already on a bill; the rest of each purchase is already owed.
 * Parcel n of N on month M puts n+1..N on the months after, unless that parcel is already known.
 * Two purchases with the same text, parcel value and count read as one.
 */
const withFutureParcels = (lines: readonly BankCardLine[]): BankCardLine[] => {
  const out = [...lines];
  for (const l of lines) {
    const { installment: n, installments: total } = l;
    if (n === null || total === null || n >= total) continue;
    for (let k = n + 1; k <= total; k++) {
      const next = { ...l, installment: k, billMonth: nextMonth(l.billMonth, k - n) };
      if (!out.some((o) => samePurchase(o, next))) out.push(next);
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
  // A closed bill counts by its total, even when the bank listed only part of it.
  const totals = new Map<string, Cents>();
  for (const b of closed) {
    const card = byCard.get(normalizeName(b.card));
    if (!card) continue;
    const key = `${normalizeName(card.name)}|${b.billMonth}`;
    totals.set(key, b.total);
    if (!groups.has(key)) groups.set(key, { card, month: b.billMonth, lines: [] });
  }
  const out: BillCheck[] = [];
  for (const [key, { card, month, lines: ls }] of groups) {
    const [y, m] = month.split("-").map(Number);
    if (!y || !m) continue;
    const { due } = cycleForDueMonth(card, y, m);
    if (diffDays(today, due) <= 0) continue;
    const bank = totals.get(key) ?? add(ZERO, ...ls.map((l) => l.amount));
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
  /** The bank account it happened in, so a move between two of the owner's accounts is seen. */
  readonly account?: string;
  /** The bank's id for it, so a decision about it (launched, ignored) sticks. */
  readonly id?: string;
}

/** How far apart the two sides of a move between the owner's accounts may be dated. */
export const TRANSFER_DAYS = 2;

/** Paying a card bill from the account: the bills are checked on their own. */
const BILL_PAYMENT = /gastos cart[aã]o|pagamento (de )?fatura|pagto\.? fatura/i;

/** How far apart the bank's date and the sheet's day may be, as in Actual Budget's matching. */
export const MATCH_DAYS = 7;

/** One line of the sheet a movement can stand for, signed like the movement. */
export interface SheetLine {
  readonly date: LocalDate;
  readonly column: Column;
  readonly section: string | null;
  readonly description: string;
  readonly amount: Cents;
}

/** The sheet's lines of one column; a cell without a note counts as one line of its total. */
const sheetLines = (
  date: LocalDate,
  column: Column,
  cell: { amount: Cents; items: readonly NoteItem[] },
): SheetLine[] => {
  const sign = column === "entrada" ? 1 : -1;
  const items =
    cell.items.length > 0
      ? cell.items
      : cell.amount === 0
        ? []
        : [{ amount: cell.amount, description: "", section: null }];
  return items
    .filter((i) => i.amount !== 0)
    .map((i) => ({
      date,
      column,
      section: i.section,
      description: i.description,
      amount: cents(sign * i.amount),
    }));
};

export interface Matching {
  /** Movements up to today the sheet should have: no transfers, no card bill payments. */
  readonly open: readonly BankMovement[];
  /** Those with no sheet line, oldest first. */
  readonly unmatched: readonly BankMovement[];
  /** Each movement and the one sheet line it was matched to. */
  readonly pairs: readonly { readonly movement: BankMovement; readonly line: SheetLine }[];
  /** Sheet lines no movement took (card bills aside: no movement pays them one by one). */
  readonly free: readonly SheetLine[];
  /** Money moved between two linked accounts: what left one and came into the other. */
  readonly transfers: readonly { readonly out: BankMovement; readonly in: BankMovement }[];
}

/**
 * The bank's account movements against the sheet. A movement matches a sheet line of the same
 * amount, same direction, within MATCH_DAYS; each sheet line answers for one movement only, the
 * closest in date first; what is left may still be two lines of one sheet day added up. Money
 * moved between two linked accounts (the same amount out of one and into another within
 * TRANSFER_DAYS, or both sides with the same text in one account) and card bill payments never
 * reach the sheet as such, so they are left out.
 */
export const matchMovements = (
  ledger: Ledger,
  movements: readonly BankMovement[],
  today: LocalDate,
): Matching => {
  const pool = ledger.flatMap((r) =>
    [
      ...sheetLines(r.date, "entrada", r.entrada),
      ...sheetLines(r.date, "saida", r.saida),
      ...sheetLines(r.date, "diario", r.diario),
    ].map((line) => ({ line, used: false })),
  );
  const transfers: { out: BankMovement; in: BankMovement }[] = [];
  const moved = new Set<BankMovement>();
  const outs = movements.filter((m) => m.amount < 0);
  for (const m of movements) {
    if (m.amount <= 0 || m.account === undefined) continue;
    const other = outs.find(
      (o) =>
        !moved.has(o) &&
        o.account !== undefined &&
        o.amount === -m.amount &&
        Math.abs(diffDays(o.date, m.date)) <= TRANSFER_DAYS &&
        // Within one account only when both sides say the same: a bank shows an inner move twice.
        (o.account !== m.account || o.description === m.description),
    );
    if (!other) continue;
    moved.add(m);
    moved.add(other);
    transfers.push({ out: other, in: m });
  }
  const open = movements.filter(
    (m) =>
      diffDays(m.date, today) >= 0 &&
      m.amount !== 0 &&
      !moved.has(m) &&
      !(m.amount < 0 && BILL_PAYMENT.test(m.description)),
  );
  const candidates = open
    .flatMap((m) =>
      pool
        .filter(
          (p) =>
            p.line.amount === m.amount && Math.abs(diffDays(p.line.date, m.date)) <= MATCH_DAYS,
        )
        .map((p) => ({ m, p, distance: Math.abs(diffDays(p.line.date, m.date)) })),
    )
    .sort((a, b) => a.distance - b.distance);
  const pairs: { movement: BankMovement; line: SheetLine }[] = [];
  const matched = new Set<BankMovement>();
  for (const { m, p } of candidates) {
    if (matched.has(m) || p.used) continue;
    p.used = true;
    matched.add(m);
    pairs.push({ movement: m, line: p.line });
  }
  // One transfer can pay two lines of the same day: R$ 1.123,51 for "car 1.006,51" and "pharmacy 117,00".
  for (const m of open) {
    if (matched.has(m)) continue;
    const near = pool.filter(
      (p) =>
        !p.used &&
        Math.sign(p.line.amount) === Math.sign(m.amount) &&
        Math.abs(diffDays(p.line.date, m.date)) <= MATCH_DAYS,
    );
    const pair = near.flatMap((a, i) =>
      near
        .slice(i + 1)
        .filter((b) => b.line.date === a.line.date && a.line.amount + b.line.amount === m.amount)
        .map((b) => [a, b] as const),
    )[0];
    if (!pair) continue;
    for (const p of pair) p.used = true;
    matched.add(m);
  }
  return {
    open,
    unmatched: open.filter((m) => !matched.has(m)).sort((a, b) => a.date.localeCompare(b.date)),
    pairs,
    free: pool.filter((p) => !p.used).map((p) => p.line),
    transfers,
  };
};

/** Movements up to today with no sheet line; see `matchMovements`. */
export const unmatchedMovements = (
  ledger: Ledger,
  movements: readonly BankMovement[],
  today: LocalDate,
): BankMovement[] => [...matchMovements(ledger, movements, today).unmatched];
