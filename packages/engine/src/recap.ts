import type { LocalDate } from "./date.ts";
import { parts } from "./date.ts";
import { add, type Cents, sub, ZERO } from "./money.ts";
import type { MonthView } from "./projection.ts";

/**
 * The month that just closed, in a few lines, during the first days of the next one: the
 * monthly look back the method asks for (performance, what was kept, what it cost to live),
 * straight from the sheet's closed month. Nothing here looks ahead.
 */

/** Days into the new month the recap stays on Hoje. */
export const RECAP_DAYS = 7;

/** Months of living cost the reserve can reach: a first month, then the method's 3, 6 and 12. */
export const RESERVE_MARKS = [1, 3, 6, 12] as const;
/** The low end of the method's 20–30% of the income kept. */
export const KEPT_GOAL = 20;

/**
 * What the closed month achieved, celebrated once in its recap. Only outcomes the sheet shows,
 * never app activity: ending in the blue, keeping the method's share, a reserve mark crossed.
 */
export type Win =
  | {
      readonly kind: "blue" /** Closed months in a row that ended above zero. */;
      readonly months: number;
    }
  | { readonly kind: "kept"; readonly share: number }
  | {
      readonly kind: "reserve" /** The highest mark first crossed this month. */;
      readonly months: number;
    };

export interface MonthRecap {
  readonly year: number;
  readonly month: number;
  /** The method's performance: end balance minus start balance. */
  readonly result: Cents;
  readonly saved: Cents;
  readonly savedShare: number | null;
  readonly livingCost: Cents;
  /** Living cost minus the month before's; null when that month has no lines. */
  readonly costChange: Cents | null;
  /** The month's largest Saída, by description. */
  readonly top: { readonly label: string; readonly amount: Cents } | null;
  readonly wins: readonly Win[];
}

const moved = (m: MonthView) => m.entrada !== 0 || m.saida !== 0 || m.diario !== 0;
const key = (m: { year: number; month: number }) => m.year * 100 + m.month;

/** Living months up to `closed`, oldest first: the run of blue months and the reserve read them. */
const wins = (months: readonly MonthView[], closed: MonthView): Win[] => {
  const upTo = months
    .filter((m) => key(m) <= key(closed) && moved(m))
    .sort((a, b) => key(a) - key(b));
  const out: Win[] = [];
  let run = 0;
  for (let i = upTo.length - 1; i >= 0 && (upTo[i]?.result ?? 0) > 0; i--) run++;
  if (run > 0) out.push({ kind: "blue", months: run });
  if (closed.savedShare !== null && closed.savedShare >= KEPT_GOAL)
    out.push({ kind: "kept", share: closed.savedShare });
  // The reserve as reserve.ts reads it: kept so far over today's cost of living (last 3 months).
  const recent = upTo.slice(-3);
  const cost = add(ZERO, ...recent.map((m) => m.livingCost));
  if (cost > 0) {
    const covered = (kept: Cents) => (kept * recent.length) / cost;
    const keptBefore = add(ZERO, ...months.filter((m) => key(m) < key(closed)).map((m) => m.saved));
    const was = covered(keptBefore);
    const is = covered(add(keptBefore, closed.saved));
    const mark = RESERVE_MARKS.filter((n) => was < n && is >= n).at(-1);
    if (mark !== undefined) out.push({ kind: "reserve", months: mark });
  }
  return out;
};

/**
 * The wins of any closed month, as its recap showed them: the Mês screen keeps them after the
 * recap leaves Hoje. Empty for a month the sheet has no lines for. The caller passes only
 * closed months; this does not look at today.
 */
export const monthWins = (months: readonly MonthView[], year: number, month: number): Win[] => {
  const closed = months.find((x) => x.year === year && x.month === month && moved(x));
  return closed ? wins(months, closed) : [];
};

export const monthRecap = (months: readonly MonthView[], today: LocalDate): MonthRecap | null => {
  const { year, month, day } = parts(today);
  if (day > RECAP_DAYS) return null;
  const at = (y: number, m: number) =>
    months.find((x) => x.year === y && x.month === m && moved(x)) ?? null;
  const prev = (y: number, m: number) => (m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 });
  const p = prev(year, month);
  const closed = at(p.y, p.m);
  if (!closed) return null;
  const pp = prev(p.y, p.m);
  const before = at(pp.y, pp.m);
  const top = closed.outflows[0];
  return {
    year: closed.year,
    month: closed.month,
    result: closed.result,
    saved: closed.saved,
    savedShare: closed.savedShare,
    livingCost: closed.livingCost,
    costChange: before ? sub(closed.livingCost, before.livingCost) : null,
    top: top ? { label: top.label, amount: top.amount } : null,
    wins: wins(months, closed),
  };
};
