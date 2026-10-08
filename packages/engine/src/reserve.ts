import { add, type Cents, cents, divFloor, mul, ZERO } from "./money.ts";

/**
 * The emergency reserve as the method teaches it (curso 05, aula 01): cost of living times the
 * months of peace you want, at least 6 and up to 12 [11:38], with the cost taken as it is today,
 * no discount [13:05]. Everything here comes from the sheet's own months: nothing is predicted.
 */

export const RESERVE_MONTHS = { min: 6, max: 12 } as const;
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
