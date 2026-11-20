import type { BankCardLine } from "./bank.ts";
import { normalizeName } from "./cards.ts";
import type { LocalDate } from "./date.ts";
import { add, type Cents, cents, mul, ZERO } from "./money.ts";

/**
 * Purchases on the owner's cards that are someone else's (a partner's, a brother's), marked by
 * the owner so the money they will pay back is known ahead (specs/006-sobrar). Like Monarch's
 * per-transaction owner and Nubank's "Dividir valor", the mark starts from the charge on the bill.
 * Nothing is guessed: only what the owner marked.
 */
export interface OwnerMark {
  /** See `ownerKey` and `monthlyKey`. */
  readonly key: string;
  readonly person: string;
  /**
   * Their part of each charge, when the owner split it (half, a third, a value he typed); absent
   * when the whole charge is theirs. Never more than the charge itself.
   */
  readonly share?: Cents;
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
 * A subscription split for good (Dividir todo mês): every charge of this store, card and value,
 * whatever the day, so each month's charge follows without a new mark. A one-off purchase of
 * another value at the same store stays the owner's.
 */
export const monthlyKey = (
  l: Pick<BankCardLine, "card" | "description" | "amount">,
): string | null => {
  const store = storeOf(l.description);
  if (l.amount <= 0 || !store) return null;
  return `${normalizeName(l.card)}|${store}|${l.amount}|mensal`;
};

/** What someone else pays of a charge under their mark: their share, or all of it. */
export const partOf = (l: Pick<BankCardLine, "amount">, mark: OwnerMark): Cents =>
  mark.share === undefined ? l.amount : cents(Math.max(0, Math.min(mark.share, l.amount)));

/**
 * The mark a line falls under; null for the owner's own. A single charge follows a mark of its
 * own day first, then a subscription's monthly mark. The bank puts a plan's rounding on its
 * first parcel (150,07, then 150,01), so a parcel also follows a mark of its plan within a cent per
 * parcel, as the bills tell two parcels of one purchase apart.
 */
export const markOf = (l: BankCardLine, marks: readonly OwnerMark[]): OwnerMark | null => {
  const key = marks.length === 0 ? null : ownerKey(l);
  if (!key) return null;
  const exact = marks.find((m) => m.key === key);
  const count = l.installments ?? 1;
  if (exact) return exact;
  if (count <= 1) {
    const monthly = monthlyKey(l);
    return marks.find((m) => m.key === monthly) ?? null;
  }
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
  /** What this person pays of it: all of it, or their share when the owner split it. */
  readonly part: Cents;
  /** Their part of its parcels still to come on later bills. */
  readonly later: Cents;
}

/** What one person owes on the bills due in a month. */
export interface Owed {
  readonly person: string;
  /** Their part of their lines on that month's bills. */
  readonly total: Cents;
  /** Their part of the parcels still to come on later bills, already bought: not a forecast. */
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
    const mark = markOf(l, marks);
    if (!mark) continue;
    const left = (l.installments ?? 1) > 1 ? (l.installments ?? 0) - (l.installment ?? 1) : 0;
    const part = partOf(l, mark);
    by.set(mark.person, [
      ...(by.get(mark.person) ?? []),
      {
        card: l.card,
        description: l.description,
        amount: l.amount,
        ...(l.date ? { date: l.date } : {}),
        installment: l.installment,
        installments: l.installments,
        part,
        later: mul(part, Math.max(0, left)),
      },
    ]);
  }
  return [...by]
    .map(([person, items]) => ({
      person,
      total: add(ZERO, ...items.map((i) => i.part)),
      later: add(ZERO, ...items.map((i) => i.later)),
      lines: items.length,
      items: items.toSorted((a, b) => b.part - a.part || b.amount - a.amount),
    }))
    .sort((a, b) => b.total - a.total || a.person.localeCompare(b.person));
};

/**
 * Whose card a card someone else pays is, by its name in the sheet: the person whose name is a
 * word of it ("Bradesco Lia" is Lia's). Null when no named person fits, or more than one does.
 */
export const cardOwner = (card: string, people: readonly string[]): string | null => {
  const name = ` ${normalizeName(card)} `;
  const fits = people.filter(
    (p) => normalizeName(p) !== "" && name.includes(` ${normalizeName(p)} `),
  );
  return fits.length === 1 ? (fits[0] ?? null) : null;
};

/**
 * A line in the sheet that is someone's payback, by its name: it ends with a named person's name
 * ("Graphisoft Lia", "Lia"). The person, or null.
 */
export const paybackPerson = (description: string, people: readonly string[]): string | null => {
  const name = normalizeName(description);
  return (
    people.find((p) => {
      const who = normalizeName(p);
      return who !== "" && (name === who || name.endsWith(` ${who}`));
    }) ?? null
  );
};
