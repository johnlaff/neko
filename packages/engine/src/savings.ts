import type { LocalDate } from "./date.ts";
import { type Cents, cents, sub } from "./money.ts";

/**
 * "Quanto dá para guardar": the method's advice when the horizon is green (aulas/03 …
 * 04-aula-3-resultado-do-cha-revelacao [11:48]) is to set aside a saving on the day the money
 * comes in, as big as the flow allows, leaving only a little in the account. Moving X out on the
 * payday lowers every balance after it by X, so X is the lowest balance ahead minus a cushion.
 */
export interface SaveDay {
  readonly date: LocalDate;
  /** Projected balance at the end of the day. */
  readonly balance: Cents;
  readonly income: Cents;
}

export interface Saving {
  /** The payday: the biggest income in the next weeks. */
  readonly date: LocalDate;
  readonly income: Cents;
  readonly amount: Cents;
  /** The lowest balance from the payday on, before saving. */
  readonly lowest: Cents;
  readonly lowestDate: LocalDate;
  /** The lowest balance after saving: about the cushion. */
  readonly leftAtLowest: Cents;
  /** The last day the sheet reaches: past it there is nothing to check. */
  readonly until: LocalDate;
}

/** What stays in the account at the lowest point: "pode deixar amarelinho". */
export const SAVING_CUSHION = cents(500_00);
const STEP = 50_00;
const MIN_AMOUNT = 100_00;
/** The payday is looked for this many days ahead (one salary cycle). */
const PAYDAY_WINDOW = 35;
/** Without at least this many days after the payday, the lowest point is a guess. */
const MIN_HORIZON = 30;

export const saveable = (days: readonly SaveDay[]): Saving | null => {
  let at = -1;
  for (let i = 0; i < Math.min(days.length, PAYDAY_WINDOW); i++) {
    const d = days[i];
    if (d && d.income > 0 && (at < 0 || d.income > (days[at]?.income ?? 0))) at = i;
  }
  const rest = days.slice(at);
  const payday = rest[0];
  const last = rest.at(-1);
  if (at < 0 || !payday || !last || rest.length < MIN_HORIZON) return null;
  let low = payday;
  for (const d of rest) if (d.balance < low.balance) low = d;
  const amount = Math.floor(sub(low.balance, SAVING_CUSHION) / STEP) * STEP;
  if (amount < MIN_AMOUNT) return null;
  return {
    date: payday.date,
    income: payday.income,
    amount: cents(amount),
    lowest: low.balance,
    lowestDate: low.date,
    leftAtLowest: sub(low.balance, cents(amount)),
    until: last.date,
  };
};
