import type { BankCardLine } from "./bank.ts";
import { normalizeName } from "./cards.ts";
import type { LocalDate } from "./date.ts";
import { add, type Cents, mul, ZERO } from "./money.ts";

/**
 * Purchases on the owner's cards that are someone else's (a partner's, a brother's), marked by
 * the owner so the money they will pay back is known ahead (specs/006-sobrar). Like Monarch's
 * per-transaction owner and Nubank's "Dividir valor", the mark starts from the charge on the bill.
 * Nothing is guessed: only what the owner marked.
 */
export interface OwnerMark {
  /** See `ownerKey`. */
  readonly key: string;
  readonly person: string;
}

/** The payment company before the store ("EBN*SPOTIFY"), as the screens drop it. */
const ACQUIRER = /^\s*(dl|pg|pag|pags|mp|ifd|ec|pp|paypal|sumup|zp|ebn|ebanx)\s*\*\s*/i;

/** The store a bank text names, letters only: "EBN*SPOTIFY 12" and "Spotify" are one. */
export const storeOf = (description: string): string =>
  normalizeName(description.replace(ACQUIRER, "")).replace(/[^\p{L}]+/gu, "");

/**
 * What a mark holds on to. A parcel marks its whole plan (card, store, value, number of parcels),
 * so every bill it lands on follows; any other charge marks just itself (its day too). Null for a
 * refund, a payment, or an old line with no day: there is nothing to mark.
 */
export const ownerKey = (l: BankCardLine): string | null => {
  const store = storeOf(l.description);
  if (l.amount <= 0 || !store) return null;
  const head = `${normalizeName(l.card)}|${store}|${l.amount}`;
  if ((l.installments ?? 1) > 1) return `${head}|${l.installments}x`;
  return l.date ? `${head}|${l.date}` : null;
};

/**
 * The mark a line falls under; null for the owner's own. The bank puts a plan's rounding on its
 * first parcel (238,77, then 238,71), so a parcel also follows a mark of its plan within a cent per
 * parcel, as the bills tell two parcels of one purchase apart.
 */
export const markOf = (l: BankCardLine, marks: readonly OwnerMark[]): OwnerMark | null => {
  const key = marks.length === 0 ? null : ownerKey(l);
  if (!key) return null;
  const exact = marks.find((m) => m.key === key);
  const count = l.installments ?? 1;
  if (exact || count <= 1) return exact ?? null;
  const [card, store, , times] = key.split("|");
  return (
    marks.find((m) => {
      const [c, s, amount, x] = m.key.split("|");
      return (
        c === card && s === store && x === times && Math.abs(Number(amount) - l.amount) <= count
      );
    }) ?? null
  );
};

/** Who the line belongs to, as the owner marked it; null for the owner's own. */
export const ownerOf = (l: BankCardLine, marks: readonly OwnerMark[]): string | null =>
  markOf(l, marks)?.person ?? null;

/** One of someone else's purchases on a bill: where it is and what is still to come of it. */
export interface OwedItem {
  readonly card: string;
  readonly description: string;
  readonly amount: Cents;
  /** The day of the charge; absent in data read before it was kept. */
  readonly date?: LocalDate;
  readonly installment: number | null;
  readonly installments: number | null;
  /** Its parcels still to come on later bills. */
  readonly later: Cents;
}

/** What one person owes on the bills due in a month. */
export interface Owed {
  readonly person: string;
  /** Their lines on that month's bills. */
  readonly total: Cents;
  /** Their parcels still to come on later bills, already bought: not a forecast. */
  readonly later: Cents;
  readonly lines: number;
  /** Biggest first. */
  readonly items: readonly OwedItem[];
}

/** Each person with something on the bills due in `billMonth`, biggest first. */
export const owedOnBills = (
  lines: readonly BankCardLine[],
  billMonth: string,
  marks: readonly OwnerMark[],
): Owed[] => {
  const by = new Map<string, OwedItem[]>();
  for (const l of lines) {
    if (l.billMonth !== billMonth) continue;
    const person = ownerOf(l, marks);
    if (!person) continue;
    const left = (l.installments ?? 1) > 1 ? (l.installments ?? 0) - (l.installment ?? 1) : 0;
    by.set(person, [
      ...(by.get(person) ?? []),
      {
        card: l.card,
        description: l.description,
        amount: l.amount,
        ...(l.date ? { date: l.date } : {}),
        installment: l.installment,
        installments: l.installments,
        later: mul(l.amount, Math.max(0, left)),
      },
    ]);
  }
  return [...by]
    .map(([person, items]) => ({
      person,
      total: add(ZERO, ...items.map((i) => i.amount)),
      later: add(ZERO, ...items.map((i) => i.later)),
      lines: items.length,
      items: items.toSorted((a, b) => b.amount - a.amount),
    }))
    .sort((a, b) => b.total - a.total || a.person.localeCompare(b.person));
};
