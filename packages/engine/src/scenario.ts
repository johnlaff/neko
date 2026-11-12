import { addDays, clampedDay, daysInMonth, type LocalDate, parts, ymd } from "./date.ts";
import { firstUnplannedMonth } from "./insights.ts";
import { splitInstallments } from "./installments.ts";
import { add, type Cents, cents, mul, sub, ZERO } from "./money.ts";
import { type CanSpend, type MonthView, type Simulation, simulatePurchase } from "./projection.ts";
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
  /** Hoje's "Ainda cabem", to tell what a purchase leaves of it; null without one. */
  readonly canSpend?: CanSpend | null;
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
  /** "Ainda cabem" once the purchases' first parcels are on it; null without a purchase. */
  readonly cycle: Simulation | null;
  /**
   * The months from next on whose own bills (with the purchases' parcels) already take the whole
   * pace, `YYYY-MM`: there the scenario assumes nothing else is spent, so the answer is a best
   * case, said out loud, and `saving` is null.
   */
  readonly full: readonly string[];
  /**
   * What the changes take from (negative) or add to the lowest balance and the last month's end,
   * against the same pace without them, so nobody has to remember the number from before; null
   * without changes.
   */
  readonly effect: Effect | null;
  /** Each change on its own, in the order asked. */
  readonly effects: readonly ChangeEffect[];
}

export interface Effect {
  readonly lowest: Cents;
  readonly end: Cents;
}

export interface ChangeEffect extends Effect {
  /**
   * A purchase's parcels the pace's monthly spending already holds: they leave the balances as
   * they were and leave that much less of the month for everything else. Null when none.
   */
  readonly inPace: {
    readonly count: number;
    readonly amount: Cents;
    /** The most any month gives up to it. */
    readonly perMonth: Cents;
    /** The last month that holds one, `YYYY-MM`. */
    readonly until: string;
  } | null;
  /** Its dates (parcels or repeats) the sheet reaches: fewer than `of` past the sheet's last day. */
  readonly counted: number;
  readonly of: number;
}

const key = (year: number, month: number) => year * 12 + month;

/** The month the pace starts to count, `YYYY-MM`: the one after today's, as `ceilingHeld` reads it. */
const nextMonth = (today: LocalDate) => {
  const { year, month } = parts(today);
  return addDays(ymd(year, month, daysInMonth(year, month)), 1).slice(0, 7);
};

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

type Core = Omit<ScenarioResult, "effect" | "effects">;

const core = (input: ScenarioInput, scenario: Scenario): Core => {
  const { today, months, due, ceiling } = input;
  if (scenario.changes.length > MAX_CHANGES) throw new RangeError(`at most ${MAX_CHANGES} changes`);
  for (const c of scenario.changes) checkChange(c, today, due);
  const monthly = paceMonthly(scenario.pace, months, today, ceiling);
  const shifts = moves(scenario.changes, due);
  // A purchase is card spending: with a pace it lands on the bills the pace already fills, so
  // only what goes past the pace moves the balances. On the sheet as it is, all of it does.
  const parcels = moves(
    scenario.changes.filter((c) => c.kind === "compra"),
    due,
  );
  const bills = ownCardBills(months).map((b) => ({
    month: b.month,
    amount: sub(
      b.amount,
      add(ZERO, ...parcels.filter((p) => p.date.startsWith(b.month)).map((p) => p.amount)),
    ),
  }));
  const held = monthly === null ? () => ZERO : ceilingHeld(bills, today, monthly);
  const next = nextMonth(today);
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
  const full =
    monthly === null
      ? []
      : bills.filter((b) => b.month >= next && b.amount >= monthly).map((b) => b.month);
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
    cycle:
      input.canSpend && parcels.length > 0
        ? simulatePurchase(
            input.canSpend,
            cents(
              -add(
                ZERO,
                ...parcels.filter((p) => p.date === parcels[0]?.date).map((p) => p.amount),
              ),
            ),
          )
        : null,
    full,
    // A best case (months with nothing for the day to day) never says to put money away.
    saving:
      full.length > 0
        ? null
        : saveable(
            days
              .filter((d) => until === null || d.date < until)
              .map((d) => ({ date: d.date, balance: d.sim, income: d.income })),
          ),
  };
};

const effectOf = (with_: Core, without: Core): Effect => ({
  lowest: sub(with_.lowest?.balance ?? ZERO, without.lowest?.balance ?? ZERO),
  end: sub(with_.months.at(-1)?.endSim ?? ZERO, without.months.at(-1)?.endSim ?? ZERO),
});

/**
 * The parcels from next month on, where the pace fills each month up to its spending: what the
 * month's own bills leave of it holds the parcel, the same gap `ceilingHeld` takes.
 */
const heldParcels = (
  parcels: readonly { readonly date: LocalDate; readonly amount: Cents }[],
  input: ScenarioInput,
  monthly: Cents,
): ChangeEffect["inPace"] => {
  const next = nextMonth(input.today);
  const bills = ownCardBills(input.months);
  const held = parcels.flatMap((p) => {
    const m = p.date.slice(0, 7);
    const bill = bills.find((b) => b.month === m);
    if (m < next || !bill) return [];
    const gap = Math.max(0, monthly - bill.amount);
    const amount = Math.min(-p.amount, gap);
    return amount > 0 ? [{ month: m, amount }] : [];
  });
  const last = held.at(-1);
  if (!last) return null;
  return {
    count: held.length,
    amount: cents(held.reduce((t, h) => t + h.amount, 0)),
    perMonth: cents(Math.max(...held.map((h) => h.amount))),
    until: last.month,
  };
};

export const simulate = (input: ScenarioInput, scenario: Scenario): ScenarioResult => {
  const result = core(input, scenario);
  if (scenario.changes.length === 0) return { ...result, effect: null, effects: [] };
  const alone = core(input, { pace: scenario.pace, changes: [] });
  const last = result.days.at(-1)?.date ?? input.today;
  return {
    ...result,
    effect: effectOf(result, alone),
    effects: scenario.changes.map((c) => {
      const dates = moves([c], input.due);
      return {
        ...effectOf(core(input, { pace: scenario.pace, changes: [c] }), alone),
        inPace:
          c.kind === "compra" && result.monthly !== null
            ? heldParcels(dates, input, result.monthly)
            : null,
        counted: dates.filter((d) => d.date <= last).length,
        of: dates.length,
      };
    }),
  };
};
