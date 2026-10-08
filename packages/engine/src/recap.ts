import type { LocalDate } from "./date.ts";
import { parts } from "./date.ts";
import { type Cents, sub } from "./money.ts";
import type { MonthView } from "./projection.ts";

/**
 * The month that just closed, in a few lines, during the first days of the next one: the
 * monthly look back the method asks for (performance, what was kept, what it cost to live),
 * straight from the sheet's closed month. Nothing here looks ahead.
 */

/** Days into the new month the recap stays on Hoje. */
export const RECAP_DAYS = 7;

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
}

const moved = (m: MonthView) => m.entrada !== 0 || m.saida !== 0 || m.diario !== 0;

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
  };
};
