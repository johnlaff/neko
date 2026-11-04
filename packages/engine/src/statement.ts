import { type BankCardLine, withFutureParcels } from "./bank.ts";
import { normalizeName } from "./cards.ts";
import { diffDays, type LocalDate } from "./date.ts";
import { add, type Cents, cents, sub, ZERO } from "./money.ts";

/**
 * The bank's own bill (specs/003-open-finance, "Fatura do banco"). Open Finance leaves lines out:
 * credits like a dispute's "AJUSTE A CRÉDITO", the second of two equal charges on one day, a ride
 * on the closing day. The bill the owner downloads from the bank has them all, so its lines fill
 * in what the feed lacks. The feed stays the source: the bill only adds what the feed does not
 * have yet, and once the feed sends a line, the bill's copy pairs with it and drops out.
 */

/** One line as the bill prints it: positive a charge, negative a credit. */
export interface StatementLineRead {
  readonly date: LocalDate;
  readonly description: string;
  readonly amount: Cents;
  readonly installment: number | null;
  readonly installments: number | null;
}

/** One card's part of the bill, as printed. */
export interface StatementCard {
  /** The card's last digits. */
  readonly number: string;
  /** What the bill prints for this card, previous balance and payments included. */
  readonly total: Cents;
  /** An earlier bill not yet paid, carried on this card ("SALDO ANTERIOR"). */
  readonly previous: Cents;
  /** Payments of earlier bills on it, as a positive amount. */
  readonly paid: Cents;
  readonly lines: readonly StatementLineRead[];
}

/** A whole bill as read from the bank's PDF. */
export interface StatementRead {
  readonly due: LocalDate;
  /** False while the bank still adds to it ("em aberto"). */
  readonly closed: boolean;
  readonly total: Cents;
  readonly cards: readonly StatementCard[];
  /** Charges the bank already scheduled for this bill (parcels), outside the cards' totals. */
  readonly scheduled: readonly (StatementLineRead & { readonly number: string })[];
}

/** A card, or the whole bill (`card` null), whose lines do not add up to what it prints. */
export interface StatementProblem {
  readonly card: string | null;
  readonly printed: Cents;
  readonly read: Cents;
}

/**
 * A read is kept only when every card's lines, with its previous balance and less its payments,
 * make exactly the total it prints, and the cards make the bill's total: a line read wrong or
 * missed never gets in.
 */
export const checkStatement = (read: StatementRead): StatementProblem[] => {
  const problems: StatementProblem[] = [];
  for (const c of read.cards) {
    const got = sub(add(c.previous, ...c.lines.map((l) => l.amount)), c.paid);
    if (got !== c.total) problems.push({ card: c.number, printed: c.total, read: got });
  }
  const cards = add(ZERO, ...read.cards.map((c) => c.total));
  if (problems.length === 0 && cards !== read.total)
    problems.push({ card: null, printed: read.total, read: cards });
  return problems;
};

/** The bill's lines on one due month, already named by the sheet's cards. */
export interface Statement {
  readonly billMonth: string;
  readonly lines: readonly BankCardLine[];
}

/** How far apart the feed and the bill may date one charge the feed put on a neighbouring bill. */
export const MOVED_DAYS = 3;

const isParcel = (l: BankCardLine) => (l.installments ?? 1) > 1;

const monthIndex = (month: string) => {
  const [y = 0, m = 1] = month.split("-").map(Number);
  return y * 12 + m;
};

/**
 * One bill line and one feed line are the same charge: same card and value, and for a parcel the
 * same number of the same count, within the cent per parcel the bank and the feed round apart.
 */
const fits = (feed: BankCardLine, want: BankCardLine): boolean => {
  if (normalizeName(feed.card) !== normalizeName(want.card)) return false;
  if (!isParcel(want)) return !isParcel(feed) && feed.amount === want.amount;
  if (!isParcel(feed)) return feed.amount === want.amount;
  return (
    feed.installment === want.installment &&
    feed.installments === want.installments &&
    Math.abs(feed.amount - want.amount) <= Math.max(1, want.installments ?? 1)
  );
};

const away = (a?: LocalDate, b?: LocalDate) => (a && b ? Math.abs(diffDays(a, b)) : 0);

/**
 * The feed's card lines with what the bills add: each bill line takes one feed line of the same
 * charge on the same bill (parcels the feed only projects included), the nearest in date. A bill
 * line without one is a line the feed left out and joins the bill; one the feed put a bill later
 * or earlier, a few days apart, moves to the bill that has it; a parcel the feed rounded apart
 * gets the bill's cents. Added lines carry `fromStatement`.
 */
export const withStatements = (
  feed: readonly BankCardLine[],
  statements: readonly Statement[],
): BankCardLine[] => {
  const pool = withFutureParcels(feed).map((l) => ({ l, used: false }));
  const extras: BankCardLine[] = [];
  const mark = (l: BankCardLine): BankCardLine => ({ ...l, fromStatement: true });
  const nearest = (from: typeof pool, want: BankCardLine) =>
    from.reduce<(typeof pool)[number] | undefined>(
      (best, p) => (!best || away(p.l.date, want.date) < away(best.l.date, want.date) ? p : best),
      undefined,
    );
  for (const s of statements) {
    for (const raw of s.lines) {
      const want = { ...raw, billMonth: s.billMonth };
      const same = nearest(
        pool.filter((p) => !p.used && p.l.billMonth === s.billMonth && fits(p.l, want)),
        want,
      );
      if (same) {
        same.used = true;
        if (same.l.amount !== want.amount)
          extras.push(
            mark({
              ...want,
              amount: cents(want.amount - same.l.amount),
              installment: null,
              installments: null,
            }),
          );
        continue;
      }
      const moved = isParcel(want)
        ? undefined
        : nearest(
            pool.filter(
              (p) =>
                !p.used &&
                !isParcel(p.l) &&
                Math.abs(monthIndex(p.l.billMonth) - monthIndex(s.billMonth)) === 1 &&
                fits(p.l, want) &&
                p.l.date !== undefined &&
                want.date !== undefined &&
                away(p.l.date, want.date) <= MOVED_DAYS,
            ),
            want,
          );
      if (moved) {
        moved.used = true;
        extras.push(mark(want), mark({ ...moved.l, amount: cents(-moved.l.amount) }));
        continue;
      }
      extras.push(mark(want));
    }
  }
  return [...feed, ...extras];
};
