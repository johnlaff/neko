import { outflowKey } from "./breakdown.ts";
import { add, type Cents, ZERO } from "./money.ts";
import type { MonthView } from "./projection.ts";

/** Months shown when a destination of "Para onde foi" opens: the half year up to the month. */
export const TREND_MONTHS = 6;

export interface TrendPoint {
  readonly year: number;
  readonly month: number;
  /** What the destination took that month; zero when it did not appear. */
  readonly amount: Cents;
}

const key = (m: { year: number; month: number }) => m.year * 12 + m.month;

/**
 * One destination of the month's Saída across the months before it, oldest first, grouped the
 * way monthOutflows groups (case, accents and the `n/N` of an installment ignored). Only months
 * the sheet has, up to the one asked: what already happened, never what comes next.
 */
export const outflowTrend = (
  months: readonly MonthView[],
  year: number,
  month: number,
  label: string,
): TrendPoint[] => {
  const k = outflowKey(label);
  const end = key({ year, month });
  return months
    .filter((m) => key(m) <= end && key(m) > end - TREND_MONTHS)
    .sort((a, b) => key(a) - key(b))
    .map((m) => ({
      year: m.year,
      month: m.month,
      amount: add(
        ZERO,
        ...(m.outflows ?? []).filter((o) => outflowKey(o.label) === k).map((o) => o.amount),
      ),
    }));
};
