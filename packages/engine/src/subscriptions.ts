import { type BankCardLine, isCardPayment } from "./bank.ts";
import { normalizeName } from "./cards.ts";
import { diffDays, type LocalDate } from "./date.ts";
import { add, type Cents, cents, ZERO } from "./money.ts";

/**
 * Subscriptions, from the bank's card lines: a charge of the very same value that comes back
 * about a month later, on the owner's cards. Only facts already charged; nothing is predicted.
 * The method gathers them under one tag to cancel them all on one day (aulas/03 … 05-aula-4-aba-
 * totais-e-tags [01:28]).
 */
export interface Subscription {
  /**
   * Store and value, as the owner marks one to cancel: two plans of one store stay apart, and a
   * second one of the same value too ("#2").
   */
  readonly key: string;
  /** The bank's text of the latest charge. */
  readonly description: string;
  readonly card: string;
  readonly amount: Cents;
  readonly last: LocalDate;
  /** Charges found in the window. */
  readonly charges: number;
  /** The same store charges another plan too (two gyms, two channels). */
  readonly twin: boolean;
}

export interface Subscriptions {
  /** Biggest first. */
  readonly items: readonly Subscription[];
  /** One month of all of them. */
  readonly total: Cents;
}

/** How far back the bank is read, and how old the last charge may be to still count. */
const WINDOW_DAYS = 100;
const STALE_DAYS = 40;
/** Monthly, give or take a short month and a charge moved by a weekend. */
const GAP_MIN = 26;
const GAP_MAX = 35;
/** Tax and late fees come back each month too, but there is nothing to cancel. */
const FEE = /\biof\b|\bmulta\b|\bjuros\b|\bencargo/i;
/** The payment company before the store ("EBN*SPOTIFY"), as the screens drop it. */
const ACQUIRER = /^\s*(dl|pg|pag|pags|mp|ifd|ec|pp|paypal|sumup|zp|ebn|ebanx)\s*\*\s*/i;

const store = (description: string) =>
  normalizeName(description.replace(ACQUIRER, "")).replace(/[^\p{L}]+/gu, "");

export const subscriptions = (
  lines: readonly BankCardLine[],
  today: LocalDate,
  othersCards: readonly string[],
): Subscriptions => {
  const others = new Set(othersCards.map(normalizeName));
  const byStore = new Map<string, (BankCardLine & { date: LocalDate })[]>();
  for (const l of lines) {
    if (!l.date || l.amount <= 0 || (l.installments ?? 1) > 1 || FEE.test(l.description)) continue;
    const age = diffDays(l.date, today);
    if (age < 0 || age > WINDOW_DAYS || others.has(normalizeName(l.card))) continue;
    const s = store(l.description);
    if (!s) continue;
    byStore.set(s, [...(byStore.get(s) ?? []), { ...l, date: l.date }]);
  }

  const items: Subscription[] = [];
  for (const [s, all] of byStore) {
    // Each series: same card and value, each charge 26 to 35 days after the one before. Two plans
    // of one value (two channels) run side by side, so a charge joins the series it continues.
    const series: (typeof all)[number][][] = [];
    for (const l of [...all].sort((a, b) => (a.date < b.date ? -1 : 1))) {
      const run = series.find((r) => {
        const prev = r[r.length - 1];
        if (!prev || prev.amount !== l.amount || normalizeName(prev.card) !== normalizeName(l.card))
          return false;
        const gap = diffDays(prev.date, l.date);
        return gap >= GAP_MIN && gap <= GAP_MAX;
      });
      if (run) run.push(l);
      else series.push([l]);
    }
    const found = series.filter((run) => {
      const last = run.at(-1);
      return run.length >= 2 && last !== undefined && diffDays(last.date, today) <= STALE_DAYS;
    });
    // Runs come oldest first: a second plan of the same value keeps its own key, "#2".
    const seen = new Map<number, number>();
    for (const run of found) {
      const last = run[run.length - 1] as (typeof run)[number];
      const n = (seen.get(last.amount) ?? 0) + 1;
      seen.set(last.amount, n);
      items.push({
        key: `${s}|${last.amount}${n > 1 ? `#${n}` : ""}`,
        description: last.description,
        card: last.card,
        amount: last.amount,
        last: last.date,
        charges: run.length,
        twin: found.length > 1,
      });
    }
  }
  items.sort((a, b) => b.amount - a.amount || a.key.localeCompare(b.key));
  return { items, total: add(ZERO, ...items.map((i) => i.amount)) };
};

/**
 * What the owner bought this month on his own cards, for the ceiling (specs/006-sobrar): by the
 * day of the purchase, a purchase in parcels at one parcel (the method puts each parcel on its own
 * bill), and without the subscriptions, which are fixed and have their own list. Card payments and
 * someone else's cards stay out.
 */
export const cardsMonthSpend = (
  lines: readonly BankCardLine[],
  from: LocalDate,
  to: LocalDate,
  othersCards: readonly string[],
  subs: readonly Subscription[],
): Cents => {
  const others = new Set(othersCards.map(normalizeName));
  const fixed = new Set(subs.map((i) => `${normalizeName(i.card)}|${i.key.replace(/#\d+$/, "")}`));
  let total = 0;
  for (const l of lines) {
    if (!l.date || l.date < from || l.date >= to) continue;
    if (others.has(normalizeName(l.card)) || isCardPayment(l)) continue;
    // Later parcels belong to a purchase of an earlier month.
    if ((l.installment ?? 1) > 1) continue;
    if (fixed.has(`${normalizeName(l.card)}|${store(l.description)}|${l.amount}`)) continue;
    total += l.amount;
  }
  return cents(total);
};
