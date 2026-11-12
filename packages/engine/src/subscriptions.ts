import { type BankCardLine, isCardPayment, withFutureParcels } from "./bank.ts";
import { normalizeName } from "./cards.ts";
import { diffDays, type LocalDate } from "./date.ts";
import { add, type Cents, cents, ZERO } from "./money.ts";
import { type OwnerMark, ownerOf, storeOf } from "./owners.ts";

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
type Charge = BankCardLine & { readonly date: LocalDate };

/**
 * The owner's charges of the window by store, oldest first, each store's split in series: same
 * card and value, each charge 26 to 35 days after the one before. Two plans of one value (two
 * channels) run side by side, so a charge joins the series it continues.
 */
const seriesByStore = (
  lines: readonly BankCardLine[],
  today: LocalDate,
  othersCards: readonly string[],
): Map<string, Charge[][]> => {
  const others = new Set(othersCards.map(normalizeName));
  const byStore = new Map<string, Charge[]>();
  for (const l of lines) {
    if (!l.date || l.amount <= 0 || (l.installments ?? 1) > 1 || FEE.test(l.description)) continue;
    const age = diffDays(l.date, today);
    if (age < 0 || age > WINDOW_DAYS || others.has(normalizeName(l.card))) continue;
    const s = storeOf(l.description);
    if (!s) continue;
    byStore.set(s, [...(byStore.get(s) ?? []), { ...l, date: l.date }]);
  }
  const out = new Map<string, Charge[][]>();
  for (const [s, all] of byStore) {
    const series: Charge[][] = [];
    for (const l of [...all].sort((a, b) => (a.date < b.date ? -1 : 1))) {
      const run = series.find((r) => {
        const prev = r[r.length - 1];
        return prev !== undefined && prev.amount === l.amount && monthApart(prev, l);
      });
      if (run) run.push(l);
      else series.push([l]);
    }
    out.set(s, series);
  }
  return out;
};

const monthApart = (a: Charge, b: Charge) => {
  if (normalizeName(a.card) !== normalizeName(b.card)) return false;
  const gap = diffDays(a.date, b.date);
  return gap >= GAP_MIN && gap <= GAP_MAX;
};

export const subscriptions = (
  lines: readonly BankCardLine[],
  today: LocalDate,
  othersCards: readonly string[],
): Subscriptions => {
  const items: Subscription[] = [];
  for (const [s, series] of seriesByStore(lines, today, othersCards)) {
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
 * A subscription out of its pattern, the kind of news worth a notification (Mia 2, part 3): a new
 * one, said on its second charge, or one whose new charge came higher than its usual value. Only
 * charges already made; nothing is predicted.
 */
export interface SubscriptionNews {
  readonly kind: "nova" | "subiu";
  /** Kind, store, value and card: the same news is said once. */
  readonly key: string;
  /** The bank's text of the charge that brought the news. */
  readonly description: string;
  readonly card: string;
  readonly amount: Cents;
  /** What it charged before, when it went up. */
  readonly before: Cents | null;
  /** Its first charge in the window. */
  readonly since: LocalDate;
  readonly date: LocalDate;
}

/** News stops being news after a week; the 06:00 read says it the morning after the charge. */
const NEWS_DAYS = 7;

export const subscriptionNews = (
  lines: readonly BankCardLine[],
  today: LocalDate,
  othersCards: readonly string[],
): SubscriptionNews[] => {
  const news: SubscriptionNews[] = [];
  const key = (kind: string, store: string, c: Charge) =>
    `${kind}|${store}|${c.amount}|${normalizeName(c.card)}`;
  for (const [store, series] of seriesByStore(lines, today, othersCards)) {
    const sameCard = (c: Charge) => (d: Charge) => normalizeName(d.card) === normalizeName(c.card);
    for (const run of series) {
      const [first, second] = run;
      const last = run.at(-1);
      if (!first || !last || diffDays(last.date, today) > NEWS_DAYS) continue;
      // Its second charge ever in the window, with nothing of the store on that card before it.
      const earlier = series
        .flat()
        .filter(sameCard(first))
        .some((c) => c.date < first.date);
      if (run.length === 2 && second && !earlier)
        news.push({
          kind: "nova",
          key: key("nova", store, second),
          description: second.description,
          card: second.card,
          amount: second.amount,
          before: null,
          since: first.date,
          date: second.date,
        });
      // A first charge at a new value, a month after a series of the old one, higher.
      if (run.length !== 1) continue;
      const usual = series.find((r) => {
        const end = r.at(-1);
        return r.length >= 2 && end !== undefined && monthApart(end, first);
      });
      const end = usual?.at(-1);
      if (usual && end && first.amount > end.amount)
        news.push({
          kind: "subiu",
          key: key("subiu", store, first),
          description: first.description,
          card: first.card,
          amount: first.amount,
          before: end.amount,
          since: usual[0]?.date ?? end.date,
          date: first.date,
        });
    }
  }
  return news.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
};

/**
 * What the bank already puts on the owner's bills due in a month (specs/006-sobrar), for the
 * ceiling: purchases, parcels and subscriptions alike, as the bills will show them, with the parcels
 * of earlier purchases the bank lists only at closing. Card payments, someone else's cards and the
 * purchases marked as someone else's (`marks`) stay out.
 */
export const cardsBillSpend = (
  lines: readonly BankCardLine[],
  billMonth: string,
  othersCards: readonly string[],
  marks: readonly OwnerMark[] = [],
): Cents => {
  const others = new Set(othersCards.map(normalizeName));
  let total = 0;
  for (const l of withFutureParcels(lines)) {
    if (
      l.billMonth !== billMonth ||
      others.has(normalizeName(l.card)) ||
      isCardPayment(l) ||
      ownerOf(l, marks) !== null
    )
      continue;
    total += l.amount;
  }
  return cents(total);
};
