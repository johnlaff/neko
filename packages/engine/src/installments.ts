import { type BankCardLine, isCardPayment, samePurchase } from "./bank.ts";
import { normalizeName } from "./cards.ts";
import { clampedDay, type LocalDate, parts, ymd } from "./date.ts";
import { add, type Cents, cents, divFloor, sub, ZERO } from "./money.ts";
import { markOf, type OwnerMark, ownerKey, partOf } from "./owners.ts";
import type { CanSpend, MonthView, Simulation } from "./projection.ts";
import { simulatePurchase } from "./projection.ts";

export const MAX_INSTALLMENTS = 24;

/** Equal parcels, as stores charge them: the cents that do not divide go on the first one. */
export const splitInstallments = (amount: Cents, count: number): Cents[] => {
  if (!Number.isInteger(count) || count < 1 || count > MAX_INSTALLMENTS)
    throw new RangeError(`installments must be 1 to ${MAX_INSTALLMENTS}: ${count}`);
  const each = divFloor(amount, count);
  const first = sub(amount, cents(each * (count - 1)));
  return [first, ...Array.from({ length: count - 1 }, () => each)];
};

export interface MonthImpact {
  readonly year: number;
  readonly month: number;
  readonly endBefore: Cents;
  readonly endAfter: Cents;
}

/** A month's lowest balance once the parcels are due, and its day (null without daily data). */
export interface MonthEnd {
  readonly year: number;
  readonly month: number;
  readonly end: Cents;
  readonly date: LocalDate | null;
}

export interface InstallmentSimulation {
  /** The open cycle with only the first parcel on it. */
  readonly cycle: Simulation;
  readonly parcels: readonly { readonly due: LocalDate; readonly amount: Cents }[];
  /** Month ends from the first parcel's month on, before and after the purchase. */
  readonly months: readonly MonthImpact[];
  /** The lowest day after the purchase, across those months. */
  readonly lowest: MonthEnd | null;
  /** The first month the purchase takes some day below zero; null when none does. */
  readonly firstNegative: MonthEnd | null;
}

/**
 * A purchase made today on the usual card in `count` parcels: the first lands on the open bill,
 * each next one on the following month's bill, and every month end from then on carries what
 * is already due.
 */
export const simulateInstallments = (
  cs: CanSpend,
  months: readonly MonthView[],
  amount: Cents,
  count: number,
): InstallmentSimulation => {
  const due = parts(cs.due);
  const parcels = splitInstallments(amount, count).map((value, k) => ({
    due: clampedDay(due.year, due.month + k, due.day),
    amount: value,
  }));
  const key = (y: number, m: number) => y * 12 + m;
  const impacts = months
    .filter((m) => key(m.year, m.month) >= key(due.year, due.month))
    .map((m) => {
      const paid = parcels.filter((p) => {
        const d = parts(p.due);
        return key(d.year, d.month) <= key(m.year, m.month);
      });
      return {
        year: m.year,
        month: m.month,
        endBefore: m.endSheet,
        endAfter: sub(m.endSheet, add(...paid.map((p) => p.amount))),
      };
    });
  const paidBy = (date: LocalDate) =>
    add(ZERO, ...parcels.filter((p) => p.due <= date).map((p) => p.amount));
  // Each day from the first parcel's due date on, as the sheet has it and with what is due so
  // far: a red day mid-month is as real as a red month end.
  const lows = months
    .filter((m) => key(m.year, m.month) >= key(due.year, due.month))
    .map((m) => {
      const days = (m.days ?? [])
        .map((d) => ({ date: ymd(m.year, m.month, d.day), balance: d.balance }))
        .filter((d) => d.date >= (parcels[0]?.due ?? cs.due));
      if (days.length === 0) {
        const paid = paidBy(clampedDay(m.year, m.month, 31));
        return {
          year: m.year,
          month: m.month,
          before: m.endSheet,
          end: sub(m.endSheet, paid),
          date: null,
        };
      }
      const after = days.map((d) => ({ date: d.date, end: sub(d.balance, paidBy(d.date)) }));
      const low = after.reduce((lo, d) => (d.end < lo.end ? d : lo));
      const before = Math.min(...days.map((d) => d.balance));
      return { year: m.year, month: m.month, before, end: low.end, date: low.date };
    });
  const end = (m: (typeof lows)[number]): MonthEnd => ({
    year: m.year,
    month: m.month,
    end: m.end,
    date: m.date,
  });
  const lowest = lows.reduce<(typeof lows)[number] | null>(
    (lo, m) => (lo === null || m.end < lo.end ? m : lo),
    null,
  );
  const negative = lows.find((m) => m.end < 0 && m.before >= 0);
  return {
    cycle: simulatePurchase(cs, parcels[0]?.amount ?? amount),
    parcels,
    months: impacts,
    lowest: lowest && end(lowest),
    firstNegative: negative ? end(negative) : null,
  };
};

/** `2026-12` plus `n` months. */
const monthPlus = (month: string, n: number): string => {
  const [y = 0, m = 1] = month.split("-").map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
};

/** Months from `a` to `b`: 1 from one month to the next. */
const monthsBetween = (a: string, b: string): number => {
  const [ya = 0, ma = 1] = a.split("-").map(Number);
  const [yb = 0, mb = 1] = b.split("-").map(Number);
  return yb * 12 + mb - (ya * 12 + ma);
};

/** One bill of a plan: its parcel and someone else's part of it. */
export interface PlanBill {
  /** `yyyy-MM`. */
  readonly month: string;
  readonly installment: number;
  readonly amount: Cents;
  /** Someone else's part of it; zero when it is all the owner's. */
  readonly theirs: Cents;
}

/** A purchase in parcels, as the bills show it (specs/008-parcelas). */
export interface InstallmentPlan {
  readonly card: string;
  readonly description: string;
  readonly date: LocalDate | null;
  readonly installments: number;
  /** The bills of its first and last parcels, `yyyy-MM`. */
  readonly first: string;
  readonly last: string;
  /** Each bill from the month asked for (or the plan's first) to its last, in order. */
  readonly bills: readonly PlanBill[];
  /** Whose it is, by the owner's mark or by being on that person's card; null for his own. */
  readonly person: string | null;
  /** Their part of each parcel when the owner split it; null when it is all one person's. */
  readonly share: Cents | null;
  /** On someone else's own card: theirs by the card, not by a mark, so there is nothing to mark. */
  readonly theirCard: boolean;
  /** What a mark of it holds on to (see `ownerKey`); null when it cannot be marked. */
  readonly key: string | null;
}

/**
 * Every purchase in parcels on the bills from `from` on. The bank lists the parcels already on a
 * bill and the rest is already owed (`withFutureParcels`): parcel n of N on one bill is n + 1 on
 * the next and n − 1 on the one before, and a bill the bank did not list takes the nearest parcel
 * it did. The bank writes a future parcel with a shorter text and puts the rounding on the first
 * one, so a plan is followed bill by bill, as `samePurchase` tells two parcels apart. Nothing is
 * estimated: the count and the value are the bank's.
 *
 * `cardOwners` names whose each card someone else pays is (normalized card name → person): a plan
 * on such a card is all theirs. On the owner's cards, a mark says whose a plan is, all of it or a
 * share of each parcel.
 */
export const installmentPlans = (
  lines: readonly BankCardLine[],
  from: string,
  marks: readonly OwnerMark[],
  cardOwners: ReadonlyMap<string, string> = new Map(),
): InstallmentPlan[] => {
  const all = lines.filter(
    (l) => (l.installments ?? 1) > 1 && l.installment !== null && l.amount > 0 && !isCardPayment(l),
  );
  // A bill listing two parcels of one purchase has the whole plan on it: nothing is left after it.
  const whole = (l: BankCardLine) =>
    all.some(
      (o) =>
        o !== l &&
        o.billMonth === l.billMonth &&
        o.installment !== l.installment &&
        samePurchase({ ...o, installment: l.installment }, l),
    );
  const parcels = all
    .filter((l) => !whole(l))
    .toSorted(
      (a, b) =>
        a.billMonth.localeCompare(b.billMonth) || (a.installment ?? 0) - (b.installment ?? 0),
    );
  const chains: BankCardLine[][] = [];
  for (const l of parcels) {
    const chain = chains.find((c) => {
      const t = c.at(-1);
      if (!t) return false;
      const gap = monthsBetween(t.billMonth, l.billMonth);
      return (
        gap > 0 &&
        samePurchase({ ...t, installment: (t.installment ?? 0) + gap, billMonth: l.billMonth }, l)
      );
    });
    if (chain) chain.push(l);
    else chains.push([l]);
  }
  const plans: InstallmentPlan[] = [];
  for (const chain of chains) {
    const [head] = chain;
    if (!head || head.installment === null || head.installments === null) continue;
    const count = head.installments;
    const first = monthPlus(head.billMonth, 1 - head.installment);
    const last = monthPlus(head.billMonth, count - head.installment);
    if (last < from) continue;
    const owner = cardOwners.get(normalizeName(head.card)) ?? null;
    const mark =
      owner === null ? (chain.map((l) => markOf(l, marks)).find((m) => m) ?? null) : null;
    const start = from > first ? from : first;
    const bills: PlanBill[] = [];
    for (let m = start; m <= last; m = monthPlus(m, 1)) {
      // The bill's own parcel, or the latest one the bank listed before it (the first, before any).
      const amount = (chain.filter((l) => l.billMonth <= m).at(-1) ?? head).amount;
      bills.push({
        month: m,
        installment: head.installment + monthsBetween(head.billMonth, m),
        amount,
        theirs: owner !== null ? amount : mark ? partOf({ amount }, mark) : ZERO,
      });
    }
    plans.push({
      card: head.card,
      description: chain.reduce(
        (long, l) => (l.description.length > long.length ? l.description : long),
        head.description,
      ),
      date: chain.find((l) => l.date)?.date ?? null,
      installments: count,
      first,
      last,
      bills,
      person: owner ?? mark?.person ?? null,
      share: owner === null && mark?.share !== undefined ? mark.share : null,
      theirCard: owner !== null,
      key: owner !== null ? null : (mark?.key ?? ownerKey(head)),
    });
  }
  return plans.sort(
    (a, b) => a.last.localeCompare(b.last) || a.description.localeCompare(b.description),
  );
};
