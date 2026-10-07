import { clampedDay, type LocalDate, parts } from "./date.ts";
import { add, type Cents, cents, divFloor, sub } from "./money.ts";
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

export interface MonthEnd {
  readonly year: number;
  readonly month: number;
  readonly end: Cents;
}

export interface InstallmentSimulation {
  /** The open cycle with only the first parcel on it. */
  readonly cycle: Simulation;
  readonly parcels: readonly { readonly due: LocalDate; readonly amount: Cents }[];
  /** Month ends from the first parcel's month on, before and after the purchase. */
  readonly months: readonly MonthImpact[];
  readonly lowest: MonthEnd | null;
  /** The first month the purchase takes below zero; null when none does. */
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
  const end = (m: MonthImpact): MonthEnd => ({ year: m.year, month: m.month, end: m.endAfter });
  const lowest = impacts.reduce<MonthImpact | null>(
    (lo, m) => (lo === null || m.endAfter < lo.endAfter ? m : lo),
    null,
  );
  const negative = impacts.find((m) => m.endAfter < 0 && m.endBefore >= 0);
  return {
    cycle: simulatePurchase(cs, parcels[0]?.amount ?? amount),
    parcels,
    months: impacts,
    lowest: lowest && end(lowest),
    firstNegative: negative ? end(negative) : null,
  };
};
