import { add, type Cents, cents, divFloor, mul, ZERO } from "./money.ts";

/**
 * The emergency reserve as the method teaches it (curso 05, aula 01): cost of living times the
 * months of peace you want, at least 6 and up to 12 [11:38], with the cost taken as it is today,
 * no discount [13:05]. Everything here comes from the sheet's own months: nothing is predicted.
 */

export const RESERVE_MONTHS = { min: 6, max: 12 } as const;
/**
 * The way up to the method's 6 to 12 months, in steps near enough to reach: a first one that fits
 * a payday, then months of the cost of living. A near subgoal makes saving easier than a far one
 * (Colby and Chapman, "Savings, subgoals, and reference points", 2013).
 */
export const RESERVE_FIRST_STEP = cents(3_000_00);
export const RESERVE_STEP_MONTHS = [1, 3, RESERVE_MONTHS.min, RESERVE_MONTHS.max] as const;
/** Closed months averaged into the cost of living: recent enough to be "today's" cost. */
export const COST_MONTHS = 3;

export interface ReserveMonth {
  readonly year: number;
  readonly month: number;
  readonly entrada: Cents;
  readonly saida: Cents;
  readonly diario: Cents;
  readonly saved: Cents;
  readonly savedToDate: Cents;
  readonly entradaToDate: Cents;
  readonly livingCost: Cents;
}

export interface Reserve {
  /** Average cost of living of the last closed months with lines on the sheet. */
  readonly cost: Cents;
  /** How many closed months went into `cost`, up to COST_MONTHS. */
  readonly costMonths: number;
  readonly min: Cents;
  readonly max: Cents;
  /** Saída under `Reserva:` dated up to today: what the sheet shows as kept, nothing planned. */
  readonly kept: Cents;
  /** kept / cost, in tenths of a month, rounded down. */
  readonly coveredTenths: number;
}

export interface YearTotals {
  readonly year: number;
  readonly entrada: Cents;
  readonly saved: Cents;
  /** saved / entrada as a whole percent, rounded; null without income. */
  readonly savedShare: number | null;
}

const key = (m: { year: number; month: number }) => m.year * 100 + m.month;
const moved = (m: ReserveMonth) => m.entrada !== 0 || m.saida !== 0 || m.diario !== 0;

export const reserve = (
  months: readonly ReserveMonth[],
  today: { year: number; month: number },
): Reserve | null => {
  const now = key(today);
  const closed = months.filter((m) => key(m) < now && moved(m)).sort((a, b) => key(a) - key(b));
  const recent = closed.slice(-COST_MONTHS);
  if (recent.length === 0) return null;
  const cost = divFloor(add(...recent.map((m) => m.livingCost)), recent.length);
  if (cost <= 0) return null;
  const kept = add(ZERO, ...months.filter((m) => key(m) <= now).map((m) => m.savedToDate));
  return {
    cost,
    costMonths: recent.length,
    min: mul(cost, RESERVE_MONTHS.min),
    max: mul(cost, RESERVE_MONTHS.max),
    kept,
    coveredTenths: Math.max(0, Math.floor((kept * 10) / cost)),
  };
};

/**
 * One year's entradas and what was kept, as the Economia tab adds them up, but only from lines
 * dated up to today: planned lines later in the year are not money kept yet.
 */
export const yearTotals = (months: readonly ReserveMonth[], year: number): YearTotals => {
  const of = months.filter((m) => m.year === year);
  const entrada = add(ZERO, ...of.map((m) => m.entradaToDate));
  const saved = add(ZERO, ...of.map((m) => m.savedToDate));
  return {
    year,
    entrada,
    saved: cents(saved),
    savedShare: entrada > 0 ? Math.round((saved / entrada) * 100) : null,
  };
};

export interface ReserveStep {
  readonly amount: Cents;
  /** Months of the cost of living; null for the first step, a fixed amount. */
  readonly months: number | null;
}

export interface ReserveSteps {
  readonly steps: readonly ReserveStep[];
  /** How many steps what was kept already covers. */
  readonly reached: number;
  /** The first step not reached yet; null past the last one. */
  readonly next: ReserveStep | null;
  /** What is still missing for `next`; zero without one. */
  readonly missing: Cents;
}

/**
 * The reserve in steps: R$ 3.000, then 1, 3, 6 and 12 months of the cost of living, against what
 * the sheet shows as kept. The first step is left out when one month already costs no more.
 */
export const reserveSteps = (r: Reserve): ReserveSteps => {
  const months = RESERVE_STEP_MONTHS.map((n) => ({ amount: mul(r.cost, n), months: n }));
  const first = months[0];
  const steps: ReserveStep[] =
    first && first.amount > RESERVE_FIRST_STEP
      ? [{ amount: RESERVE_FIRST_STEP, months: null }, ...months]
      : months;
  const reached = steps.filter((s) => r.kept >= s.amount).length;
  const next = steps[reached] ?? null;
  return { steps, reached, next, missing: next ? cents(next.amount - r.kept) : ZERO };
};

export interface SavingStep {
  readonly step: ReserveStep;
  /** The step's place, from 1. */
  readonly index: number;
  /** What is still missing for it after saving; zero when the saving reaches it. */
  readonly missing: Cents;
}

/**
 * What saving `amount` today does to the steps: the highest one it reaches, or what the next one
 * still misses. Null past the last step, and also once the method's minimum of 6 months is kept,
 * unless the saving reaches the next step: the method leaves going on to the owner [27:58], so the
 * payday does not push a far goal.
 */
export const savingStep = (r: Reserve, amount: Cents): SavingStep | null => {
  const before = reserveSteps(r);
  const after = reserveSteps({ ...r, kept: add(r.kept, amount) });
  const top = before.steps[after.reached - 1];
  if (after.reached > before.reached && top)
    return { step: top, index: after.reached, missing: ZERO };
  if (!after.next || r.kept >= mul(r.cost, RESERVE_MONTHS.min)) return null;
  return { step: after.next, index: after.reached + 1, missing: after.missing };
};
