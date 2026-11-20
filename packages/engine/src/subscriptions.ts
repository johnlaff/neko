import { type BankCardLine, isCardPayment, withFutureParcels } from "./bank.ts";
import { normalizeName } from "./cards.ts";
import { diffDays, type LocalDate } from "./date.ts";
import { add, type Cents, cents, ZERO } from "./money.ts";
import { markOf, monthlyKey, type OwnerMark, partOf, storeOf } from "./owners.ts";

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
  /** What it charges now: its latest charge, higher than the run's when it went up (`before`). */
  readonly amount: Cents;
  readonly last: LocalDate;
  /** Charges found in the window. */
  readonly charges: number;
  /** The same store charges another plan too (two gyms, two channels). */
  readonly twin: boolean;
  /** Its latest charges, oldest first: at most four. */
  readonly charged: readonly { readonly date: LocalDate; readonly amount: Cents }[];
  /** What it charged before its latest charge went up; null when it did not. */
  readonly before: Cents | null;
  /** Its second charge ever on that card came within the last month: new. */
  readonly isNew: boolean;
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
/** A price goes up a little; a charge at more than this times the plan is another purchase. */
const RISE_MAX = 1.5;
/** A new subscription is news for a month. */
const NEW_DAYS = 31;
/** Tax and late fees come back each month too, but there is nothing to cancel. */
const FEE = /\biof\b|\bmulta\b|\bjuros\b|\bencargo/i;
/** Tax, late fees and their refunds: the bank's own charges, never a store's. */
export const isFee = (description: string): boolean => FEE.test(description);
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
    if (!l.date || l.amount <= 0 || (l.installments ?? 1) > 1 || isFee(l.description)) continue;
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

/** A charge a month after the run's last at a somewhat higher value: the plan went up. */
const rises = (end: Charge, next: Charge) =>
  next.amount > end.amount && next.amount <= end.amount * RISE_MAX && monthApart(end, next);

export const subscriptions = (
  lines: readonly BankCardLine[],
  today: LocalDate,
  othersCards: readonly string[],
): Subscriptions => {
  const items: Subscription[] = [];
  for (const [s, series] of seriesByStore(lines, today, othersCards)) {
    // A lone charge that continues a run at a higher value is that run, gone up.
    const raised = (run: Charge[]) => {
      const end = run.at(-1);
      return series.find((r) => r.length === 1 && end && r[0] && rises(end, r[0]))?.[0];
    };
    const found = series.filter((run) => {
      const latest = raised(run) ?? run.at(-1);
      return run.length >= 2 && latest !== undefined && diffDays(latest.date, today) <= STALE_DAYS;
    });
    // Runs come oldest first: a second plan of the same value keeps its own key, "#2".
    const seen = new Map<number, number>();
    for (const run of found) {
      const end = run[run.length - 1] as (typeof run)[number];
      const n = (seen.get(end.amount) ?? 0) + 1;
      seen.set(end.amount, n);
      const up = raised(run);
      const latest = up ?? end;
      const first = run[0] as Charge;
      const earlier = series
        .flat()
        .some((c) => normalizeName(c.card) === normalizeName(first.card) && c.date < first.date);
      items.push({
        key: `${s}|${end.amount}${n > 1 ? `#${n}` : ""}`,
        description: latest.description,
        card: latest.card,
        amount: latest.amount,
        last: latest.date,
        charges: run.length + (up ? 1 : 0),
        twin: found.length > 1,
        charged: [...run, ...(up ? [up] : [])]
          .slice(-4)
          .map((c) => ({ date: c.date, amount: c.amount })),
        before: up ? end.amount : null,
        isNew: run.length === 2 && !up && !earlier && diffDays(end.date, today) <= NEW_DAYS,
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
  /** `cobrou`: one the owner marked to cancel charged again after the mark. */
  readonly kind: "nova" | "subiu" | "cobrou";
  /** Kind, store, value and card: the same news is said once. */
  readonly key: string;
  /** The bank's text of the charge that brought the news. */
  readonly description: string;
  readonly card: string;
  readonly amount: Cents;
  /** What it charged before, when it went up. */
  readonly before: Cents | null;
  /** Its first charge in the window; for `cobrou`, the day it was marked to cancel. */
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
      if (usual && end && rises(end, first))
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

/** What the owner said about his subscriptions (Faturas › Assinaturas), by `Subscription.key`. */
export interface SubscriptionMarks {
  /** Marked "Vou cancelar". */
  readonly cancel: readonly string[];
  /** The day each was marked to cancel, when known: a charge after it is news. */
  readonly cancelOn?: Readonly<Record<string, LocalDate>>;
  /** Kept on purpose ("Manter", one by one): nothing left to decide about them. */
  readonly kept?: readonly string[];
  /** "Não é assinatura": out of the list and its total. */
  readonly hidden?: readonly string[];
  /** Purchases marked as someone else's: a monthly mark (`monthlyKey`) splits a subscription. */
  readonly owners?: readonly OwnerMark[];
}

export interface SubscriptionRow extends Subscription {
  readonly cancel: boolean;
  readonly kept: boolean;
  /** It charged again after the owner marked it to cancel: the day of the latest such charge. */
  readonly again: LocalDate | null;
  /** The key a split of it is saved under (`monthlyKey` of its latest charge). */
  readonly splitKey: string | null;
  /** Someone pays part of it each month: who, and how much of each charge. */
  readonly split: { readonly person: string; readonly share: Cents } | null;
}

/** A subscription the owner marked to cancel that stopped charging: what it took each month. */
export interface CutSubscription {
  readonly key: string;
  readonly description: string;
  readonly amount: Cents;
}

export interface SubscriptionList {
  /** Biggest first: every subscription still charging, and any marked one that charged again. */
  readonly items: readonly SubscriptionRow[];
  /** One month of all of them. */
  readonly total: Cents;
  /** One month of the ones marked to cancel. */
  readonly toCancel: Cents;
  /** Neither marked to cancel nor kept: what "Revisar uma a uma" goes through first. */
  readonly undecided: number;
  /** Marked to cancel and no longer charging: facts, not estimates. */
  readonly cut: { readonly items: readonly CutSubscription[]; readonly total: Cents };
  /** What the owner said is not a subscription, still charging: one tap puts each back. */
  readonly hidden: readonly SubscriptionRow[];
}

/** `spotify|2390#2` → its store and value. */
const keyParts = (key: string) => {
  const [store = "", rest = ""] = key.split("|");
  return { store, amount: Number(rest.split("#")[0]) };
};

const capitalized = (store: string) => store.charAt(0).toUpperCase() + store.slice(1);

/**
 * The subscriptions as the owner sees them: each with his marks, the ones he cut, and the ones
 * that charged again after he marked them to cancel (Rocket Money's re-bill alert). A cut is a
 * mark whose store charged nothing on his cards for `STALE_DAYS`: a new value of the same store
 * is the same plan gone up, not a cut. Only charges already made; nothing is predicted.
 */
export const subscriptionList = (
  lines: readonly BankCardLine[],
  today: LocalDate,
  othersCards: readonly string[],
  marks: SubscriptionMarks,
): SubscriptionList => {
  const { items } = subscriptions(lines, today, othersCards);
  const others = new Set(othersCards.map(normalizeName));
  const charges = lines.filter(
    (l): l is Charge =>
      l.date !== undefined &&
      l.amount > 0 &&
      (l.installments ?? 1) <= 1 &&
      !others.has(normalizeName(l.card)) &&
      diffDays(l.date, today) >= 0,
  );
  const cancel = new Set(marks.cancel);
  const kept = new Set(marks.kept ?? []);
  const hide = new Set(marks.hidden ?? []);
  const owners = marks.owners ?? [];
  const after = (key: string) => {
    const on = marks.cancelOn?.[key];
    if (!on || !cancel.has(key)) return [];
    const { store, amount } = keyParts(key);
    return charges
      .filter((c) => c.date > on && c.amount === amount && storeOf(c.description) === store)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  };
  const row = (i: Subscription): SubscriptionRow => {
    const splitKey = monthlyKey(i);
    const mark = owners.find((m) => m.key === splitKey);
    return {
      ...i,
      cancel: cancel.has(i.key),
      kept: kept.has(i.key),
      again: after(i.key).at(-1)?.date ?? null,
      splitKey,
      split: mark ? { person: mark.person, share: partOf(i, mark) } : null,
    };
  };
  const rows = items.map(row);
  // Stopped, then charged again after the mark: back on the list, said on top.
  for (const key of cancel) {
    if (rows.some((r) => r.key === key)) continue;
    const back = after(key);
    const latest = back.at(-1);
    if (!latest) continue;
    rows.push(
      row({
        key,
        description: latest.description,
        card: latest.card,
        amount: latest.amount,
        last: latest.date,
        charges: back.length,
        twin: false,
        charged: back.slice(-4).map((c) => ({ date: c.date, amount: c.amount })),
        before: null,
        isNew: false,
      }),
    );
  }
  rows.sort((a, b) => b.amount - a.amount || a.key.localeCompare(b.key));
  const shown = rows.filter((r) => !hide.has(r.key));
  const cut = [...cancel].flatMap((key): CutSubscription[] => {
    if (hide.has(key) || rows.some((r) => r.key === key)) return [];
    const { store, amount } = keyParts(key);
    if (!store || !Number.isInteger(amount) || amount <= 0) return [];
    const ofStore = charges.filter((c) => storeOf(c.description) === store);
    if (ofStore.some((c) => diffDays(c.date, today) <= STALE_DAYS)) return [];
    const last = ofStore.filter((c) => c.amount === amount).at(-1);
    return [{ key, description: last?.description ?? capitalized(store), amount: cents(amount) }];
  });
  const sum = (xs: readonly { amount: Cents }[]) => add(ZERO, ...xs.map((x) => x.amount));
  return {
    items: shown,
    total: sum(shown),
    toCancel: sum(shown.filter((r) => r.cancel)),
    undecided: shown.filter((r) => !r.cancel && !r.kept).length,
    cut: { items: cut, total: sum(cut) },
    hidden: rows.filter((r) => hide.has(r.key)),
  };
};

/**
 * A subscription marked to cancel that charged again after the mark, this week: news worth a
 * notification, said once, so a cancellation that did not go through is caught in time.
 */
export const chargedAgainNews = (
  list: SubscriptionList,
  today: LocalDate,
  cancelOn: Readonly<Record<string, LocalDate>>,
): SubscriptionNews[] =>
  list.items.flatMap((r) => {
    const on = cancelOn[r.key];
    if (!r.again || !on || diffDays(r.again, today) > NEWS_DAYS) return [];
    return [
      {
        kind: "cobrou" as const,
        key: `cobrou|${r.key}|${r.again}`,
        description: r.description,
        card: r.card,
        amount: r.amount,
        before: null,
        since: on,
        date: r.again,
      },
    ];
  });

/**
 * What the bank already puts on the owner's bills due in a month (specs/006-sobrar), for the
 * ceiling: purchases, parcels and subscriptions alike, as the bills will show them, with the parcels
 * of earlier purchases the bank lists only at closing. Card payments and someone else's cards stay
 * out, and of a purchase marked as someone else's (`marks`) only the owner's part counts.
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
    if (l.billMonth !== billMonth || others.has(normalizeName(l.card)) || isCardPayment(l))
      continue;
    const mark = markOf(l, marks);
    total += mark ? l.amount - partOf(l, mark) : l.amount;
  }
  return cents(total);
};
