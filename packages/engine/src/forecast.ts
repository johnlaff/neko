import {
  type BankCardLine,
  type BankMovement,
  isCardPayment,
  matchMovements,
  originKey,
} from "./bank.ts";
import { normalizeName } from "./cards.ts";
import { addDays, diffDays, type LocalDate } from "./date.ts";
import type { Placement } from "./entries.ts";
import { type CellValue, FORECAST, forecastIn, isForecastItem, type Ledger } from "./ledger.ts";
import { add, type Cents, cents, sub, ZERO } from "./money.ts";

/**
 * Diário previsto (specs/005-lancamentos, Fase 3), the method's way for someone who pays almost
 * everything by card: each future day's Diário holds what a day usually costs, so the Saldo ahead
 * is not too rosy. Neko only suggests the value, from what the bank shows; the owner approves it.
 */

/** A Diário cell with nothing in it: empty or the literal 0, and no note line. */
export const isFreeDiario = (cell: CellValue): boolean =>
  cell.amount === 0 && cell.items.length === 0 && cell.unparsed.length === 0;

/** The cell holds Neko's forecast and nothing else: its one line is `Previsto`. */
export const isOnlyForecast = (cell: CellValue): boolean =>
  cell.items.length === 1 &&
  cell.items.every(isForecastItem) &&
  cell.unparsed.length === 0 &&
  cell.amount === forecastIn(cell);

/** A real spending added to a Diário: the writer takes the day's forecast off in the same edit. */
export const dropsForecast = (p: Placement): boolean =>
  p.column === "diario" && p.target === "line" && p.was === undefined && p.description !== FORECAST;

/** What a Diário cell holds that was really spent: its amount without the forecast. */
export const realDiario = (cell: CellValue): Cents => sub(cell.amount, forecastIn(cell));

export interface SpendInput {
  readonly ledger: Ledger;
  readonly today: LocalDate;
  readonly movements: readonly BankMovement[];
  readonly lines: readonly BankCardLine[];
  /** Cards someone else pays: their purchases are not the owner's day to day. */
  readonly othersCards: readonly string[];
  /** Accounts where the owner keeps savings: what happens inside them is not spending. */
  readonly savingsAccounts: ReadonlySet<string>;
  /** Origins (see `originKey`) the owner launched as savings. */
  readonly savedOrigins: ReadonlySet<string>;
}

export interface Spend {
  /** Purchases on the owner's cards, a purchase in parcels at its full value. */
  readonly cards: Cents;
  /** Pix, debit and cash that nothing in the sheet planned. */
  readonly pix: Cents;
  readonly total: Cents;
}

/**
 * The owner's day-to-day spending between `from` and `to` (exclusive), as the bank shows it:
 * purchases on his own cards at their full value (a purchase in 10 parcels counts all 10 on the
 * day it was made, so nothing is missing later) and the Pix and debits the sheet did not plan.
 * Bills, the car and anything else already planned in the sheet are left out: they are there.
 */
export const variableSpend = (input: SpendInput, from: LocalDate, to: LocalDate): Spend => {
  const inWindow = (d: LocalDate | undefined) => d !== undefined && d >= from && d < to;
  const others = new Set(input.othersCards.map(normalizeName));
  let cards = 0;
  for (const l of input.lines) {
    if (!inWindow(l.date) || others.has(normalizeName(l.card)) || isCardPayment(l)) continue;
    // Later parcels belong to a purchase counted whole on its first parcel.
    if ((l.installment ?? 1) > 1) continue;
    cards += l.amount * Math.max(1, l.installments ?? 1);
  }
  const matching = matchMovements(input.ledger, input.movements, input.today);
  const planned = new Set(
    matching.pairs.filter((p) => p.line.column !== "diario").map((p) => p.movement),
  );
  const unmatched = new Set(matching.unmatched);
  let pix = 0;
  for (const m of matching.open) {
    if (m.amount >= 0 || !inWindow(m.date) || planned.has(m)) continue;
    // Matched to two planned lines at once: planned too.
    if (!unmatched.has(m) && !matching.pairs.some((p) => p.movement === m)) continue;
    if (m.account !== undefined && input.savingsAccounts.has(m.account)) continue;
    if (input.savedOrigins.has(originKey(m.description))) continue;
    pix -= m.amount;
  }
  return { cards: cents(cards), pix: cents(pix), total: add(cents(cards), cents(pix)) };
};

/** How far back the suggestion and the review look. */
export const REVIEW_DAYS = 90;
/** Fewer days than this of bank data say too little about a usual day. */
const MIN_DAYS = 28;
/** The review comes back every 3 months, as the method asks. */
export const REVIEW_MONTHS = 3;

export interface DailySuggestion extends Spend {
  /** Average per day, rounded up to whole reais. */
  readonly perDay: Cents;
  readonly from: LocalDate;
  readonly days: number;
}

/**
 * What a usual day costs, from the bank's last 90 days (or since the bank has data on both the
 * cards and the accounts), rounded up to whole reais. Null with less than 4 weeks of data.
 */
export const suggestDaily = (input: SpendInput): DailySuggestion | null => {
  const first = (dates: readonly (LocalDate | undefined)[]) =>
    dates.reduce<LocalDate | undefined>((a, d) => (d && (!a || d < a) ? d : a), undefined);
  const firstCard = first(
    input.lines.filter((l) => !isCardPayment(l) && (l.installment ?? 1) <= 1).map((l) => l.date),
  );
  const firstMove = first(input.movements.map((m) => m.date));
  if (!firstCard || !firstMove) return null;
  const latest = firstCard > firstMove ? firstCard : firstMove;
  const back = addDays(input.today, -REVIEW_DAYS);
  const from = latest > back ? latest : back;
  const days = diffDays(from, input.today);
  if (days < MIN_DAYS) return null;
  const spend = variableSpend(input, from, input.today);
  const perDay = cents(Math.ceil(spend.total / days / 100) * 100);
  return { ...spend, perDay: perDay < 0 ? ZERO : perDay, from, days };
};

/** The months since `since`, counted by calendar: 3 on the same day number three months later. */
export const monthsSince = (since: LocalDate, today: LocalDate): number => {
  const [y0, m0, d0] = since.split("-").map(Number) as [number, number, number];
  const [y1, m1, d1] = today.split("-").map(Number) as [number, number, number];
  return (y1 - y0) * 12 + (m1 - m0) - (d1 < d0 ? 1 : 0);
};
