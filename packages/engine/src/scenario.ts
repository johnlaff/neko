import { clampedDay, daysInMonth, type LocalDate, parts, ymd } from "./date.ts";
import { firstUnplannedMonth } from "./insights.ts";
import { splitInstallments } from "./installments.ts";
import { add, type Cents, cents, mul, sub, ZERO } from "./money.ts";
import type { MonthView } from "./projection.ts";
import { ceilingHeld, ownCardBills, type Saving, saveable } from "./savings.ts";

/**
 * "Simular": the method's own what-if (aulas/02 … 03-aula-3-analises-e-cenarios [10:17], [16:01]):
 * type a purchase, a freela or a loan into the sheet, watch the balances change, then Ctrl+Z.
 * Here nothing is typed anywhere: the sheet's balances stay as they are and the scenario only
 * shifts copies of them. Nothing is saved; the sheet keeps holding only what is certain.
 */

/**
 * How the months ahead take the day-to-day spending the sheet does not hold yet: not at all (the
 * sheet as it is), at the ceiling (Ajustes › Teto do mês, cards and Pix), or as in the last three
 * full months.
 */
export type Pace = "planilha" | "teto" | "media";

/** One what-if on top of the pace. Amounts are positive; the kind says which way they go. */
export type Change =
  /** A purchase today on the usual card, in `count` parcels from its next bill on. */
  | { readonly kind: "compra"; readonly amount: Cents; readonly count: number }
  /** Money in or out on `date`, repeated on the same day for `months` months. */
  | {
      readonly kind: "entrada" | "saida";
      readonly amount: Cents;
      readonly date: LocalDate;
      readonly months: number;
    };

export interface Scenario {
  readonly pace: Pace;
  readonly changes: readonly Change[];
}

export const MAX_CHANGES = 8;
export const MAX_REPEAT = 24;
/** Full months the "como nos últimos meses" pace averages. */
export const PACE_MONTHS = 3;

export interface ScenarioInput {
  readonly today: LocalDate;
  readonly months: readonly MonthView[];
  /** The usual card's next due date, where a purchase's first parcel lands; null without one. */
  readonly due: LocalDate | null;
  /** Ajustes › Teto do mês; null when it is not set. */
  readonly ceiling: Cents | null;
}

export interface ScenarioDay {
  readonly date: LocalDate;
  /** The sheet's balance at the end of the day. */
  readonly sheet: Cents;
  /** The same day in the scenario. */
  readonly sim: Cents;
}

export interface ScenarioPoint {
  readonly date: LocalDate;
  readonly balance: Cents;
}

export interface ScenarioMonth {
  readonly year: number;
  readonly month: number;
  readonly endSheet: Cents;
  readonly endSim: Cents;
}

export interface ScenarioResult {
  readonly pace: Pace;
  /** What each month ahead spends on cards and Pix in the scenario; null for the sheet as it is. */
  readonly monthly: Cents | null;
  /** Every day from today to the sheet's last one. */
  readonly days: readonly ScenarioDay[];
  /** From today's month to the last. */
  readonly months: readonly ScenarioMonth[];
  readonly lowest: ScenarioPoint | null;
  /** The first day the scenario goes below zero; null when it never does. */
  readonly firstNegative: ScenarioPoint | null;
  /** The same for the sheet as it is, to tell what the scenario changed. */
  readonly sheetFirstNegative: ScenarioPoint | null;
  /** What the next payday lets you set aside in the scenario, as Hoje's "Dia de guardar" reads it. */
  readonly saving: Saving | null;
}

const key = (year: number, month: number) => year * 12 + month;

/** The pace's monthly spending, in whole reais; null for the sheet as it is. */
export const paceMonthly = (
  pace: Pace,
  months: readonly MonthView[],
  today: LocalDate,
  ceiling: Cents | null,
): Cents | null => {
  if (pace === "planilha") return null;
  if (pace === "teto") {
    if (ceiling === null) throw new RangeError("no ceiling set");
    return ceiling;
  }
  const now = parts(today);
  const full = months
    .filter((m) => key(m.year, m.month) < key(now.year, now.month) && m.dailyAverage !== null)
    .slice(-PACE_MONTHS);
  if (full.length === 0) throw new RangeError("no full month before today");
  // The diário médio real times the month's days: real diário plus your own card bills.
  const total = add(
    ZERO,
    ...full.map((m) => mul(m.dailyAverage ?? ZERO, daysInMonth(m.year, m.month))),
  );
  return cents(Math.round(total / full.length / 100) * 100);
};

const checkChange = (c: Change, today: LocalDate, due: LocalDate | null) => {
  if (!Number.isInteger(c.amount) || c.amount <= 0) throw new RangeError("amount must be positive");
  if (c.kind === "compra") {
    if (due === null) throw new RangeError("no card to put a purchase on");
    splitInstallments(c.amount, c.count);
    return;
  }
  if (!Number.isInteger(c.months) || c.months < 1 || c.months > MAX_REPEAT)
    throw new RangeError(`months must be 1 to ${MAX_REPEAT}`);
  if (c.date < today) throw new RangeError("a change cannot be in the past");
};

/** Each change as signed amounts on dates: money in is positive. */
const moves = (changes: readonly Change[], due: LocalDate | null) =>
  changes.flatMap((c) => {
    if (c.kind === "compra") {
      if (due === null) return [];
      const d = parts(due);
      return splitInstallments(c.amount, c.count).map((amount, k) => ({
        date: clampedDay(d.year, d.month + k, d.day),
        amount: cents(-amount),
      }));
    }
    const d = parts(c.date);
    return Array.from({ length: c.months }, (_, k) => ({
      date: clampedDay(d.year, d.month + k, d.day),
      amount: c.kind === "entrada" ? c.amount : cents(-c.amount),
    }));
  });

export const simulate = (input: ScenarioInput, scenario: Scenario): ScenarioResult => {
  const { today, months, due, ceiling } = input;
  if (scenario.changes.length > MAX_CHANGES) throw new RangeError(`at most ${MAX_CHANGES} changes`);
  for (const c of scenario.changes) checkChange(c, today, due);
  const monthly = paceMonthly(scenario.pace, months, today, ceiling);
  const held = monthly === null ? () => ZERO : ceilingHeld(ownCardBills(months), today, monthly);
  const shifts = moves(scenario.changes, due);
  const shift = (date: LocalDate) =>
    add(ZERO, ...shifts.filter((s) => s.date <= date).map((s) => s.amount));

  const now = parts(today);
  const ahead = months.filter((m) => key(m.year, m.month) >= key(now.year, now.month));
  const days: (ScenarioDay & { readonly income: Cents })[] = [];
  const ends: ScenarioMonth[] = [];
  for (const m of ahead) {
    for (const d of m.days) {
      const date = ymd(m.year, m.month, d.day);
      if (date < today) continue;
      const income = add(
        ZERO,
        ...d.moves.filter((x) => x.kind === "income").map((x) => x.amount),
        ...shifts.filter((s) => s.date === date && s.amount > 0).map((s) => s.amount),
      );
      days.push({
        date,
        sheet: d.balance,
        sim: add(sub(d.balance, held(date)), shift(date)),
        income,
      });
    }
    const last = days.at(-1);
    if (last && last.date.slice(0, 7) === ymd(m.year, m.month, 1).slice(0, 7))
      ends.push({ year: m.year, month: m.month, endSheet: last.sheet, endSim: last.sim });
  }

  const point = (d: ScenarioDay | undefined, sim = true): ScenarioPoint | null =>
    d ? { date: d.date, balance: sim ? d.sim : d.sheet } : null;
  const lowest = days.reduce<ScenarioDay | undefined>(
    (lo, d) => (lo === undefined || d.sim < lo.sim ? d : lo),
    undefined,
  );
  // Past a month with no spending on the sheet the balances are too rosy to save from: the same
  // window Hoje's "Dia de guardar" reads, so both say the same with the ceiling and no change.
  const unplanned = firstUnplannedMonth(months, today);
  const until = unplanned && ymd(unplanned.year, unplanned.month, 1);
  return {
    pace: scenario.pace,
    monthly,
    days: days.map(({ date, sheet, sim }) => ({ date, sheet, sim })),
    months: ends,
    lowest: point(lowest),
    firstNegative: point(days.find((d) => d.sim < 0)),
    sheetFirstNegative: point(
      days.find((d) => d.sheet < 0),
      false,
    ),
    saving: saveable(
      days
        .filter((d) => until === null || d.date < until)
        .map((d) => ({ date: d.date, balance: d.sim, income: d.income })),
    ),
  };
};
