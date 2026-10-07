import { normalizeName } from "./cards.ts";
import { type LocalDate, parts, ymd } from "./date.ts";
import { type Cents, cents, mul, sub } from "./money.ts";
import type { Projection } from "./projection.ts";

/**
 * Things worth a look, only the actionable and negative kind (users switch off feeds of
 * neutral tips): the balance going below zero on some day ahead (the method's "mar vermelho":
 * when it starts and how deep it gets, aulas/03 … 04-aula-3-resultado-do-cha-revelacao [08:50]), the usual card's bill above its average,
 * a fixed bill that went up, the usual card's closing day still a guess. Worst first, at most MAX.
 */
export type Insight =
  | {
      readonly kind: "goes-negative";
      /** First day ahead that ends below zero. */
      readonly start: LocalDate;
      /** The lowest balance in the horizon, and its day. */
      readonly deepest: Cents;
      readonly deepestDate: LocalDate;
    }
  | {
      readonly kind: "bill-above-average";
      readonly card: string;
      readonly over: Cents;
      readonly average: Cents;
    }
  | {
      readonly kind: "fixed-up";
      readonly label: string;
      readonly amount: Cents;
      readonly change: Cents;
    }
  | {
      /** The pace hinges on the closing day; while it is a guess, the allowance can be off. */
      readonly kind: "closing-estimated";
      readonly card: string;
      readonly closing: LocalDate;
    };

export const MAX_INSIGHTS = 3;
/** How many months ahead, the current one included, a red day is worth a warning. */
const MONTHS_AHEAD = 4;
/** A bill counts as above average past both of these. */
const BILL_OVER_MIN = cents(100_00);
const BILL_OVER_SHARE = 0.15;
/** A fixed bill counts as up past both of these (the subscription-increase rule of thumb). */
const FIXED_UP_MIN = cents(2_00);
const FIXED_UP_SHARE = 0.05;

type Input = Pick<
  Projection,
  "today" | "balanceToday" | "months" | "cards" | "historyAverage" | "openVsAverage"
>;

export const insights = (p: Input): Insight[] => {
  const out: Insight[] = [];
  const now = parts(p.today);
  const at = p.months.findIndex((m) => m.year === now.year && m.month === now.month);

  // Only from a balance that is not already negative: then the warning is news, not noise.
  if (at >= 0 && (p.balanceToday ?? 0) >= 0) {
    let start: LocalDate | null = null;
    let deepest: { date: LocalDate; balance: Cents } | null = null;
    for (const m of p.months.slice(at, at + MONTHS_AHEAD))
      for (const d of m.days ?? []) {
        const date = ymd(m.year, m.month, d.day);
        if (date < p.today || d.balance >= 0) continue;
        start ??= date;
        if (!deepest || d.balance < deepest.balance) deepest = { date, balance: d.balance };
      }
    if (start && deepest)
      out.push({
        kind: "goes-negative",
        start,
        deepest: deepest.balance,
        deepestDate: deepest.date,
      });
  }

  const usual = p.cards.find((c) => c.usual);
  if (usual && p.historyAverage !== null && p.openVsAverage !== null) {
    const floor = Math.max(BILL_OVER_MIN, mul(p.historyAverage, BILL_OVER_SHARE));
    if (p.openVsAverage > floor)
      out.push({
        kind: "bill-above-average",
        card: usual.card.name,
        over: p.openVsAverage,
        average: p.historyAverage,
      });
  }

  const month = at >= 0 ? p.months[at] : undefined;
  if (month) {
    const recurring = new Set(
      (month.fixed ?? []).filter((f) => f.installment === null).map((f) => normalizeName(f.label)),
    );
    const ups = (month.outflows ?? [])
      .filter(
        (o) =>
          o.kind === "bill" &&
          o.change !== null &&
          recurring.has(normalizeName(o.label)) &&
          // A second charge in the month is an extra payment, not a price that went up.
          (o.countBefore ?? o.count) === o.count,
      )
      .filter((o) => {
        const change = o.change ?? cents(0);
        return change > Math.max(FIXED_UP_MIN, mul(sub(o.amount, change), FIXED_UP_SHARE));
      })
      .sort((a, b) => (b.change ?? 0) - (a.change ?? 0));
    const top = ups[0];
    if (top && top.change !== null)
      out.push({ kind: "fixed-up", label: top.label, amount: top.amount, change: top.change });
  }

  if (usual?.card.closingEstimated)
    out.push({ kind: "closing-estimated", card: usual.card.name, closing: usual.cycle.closing });

  return out.slice(0, MAX_INSIGHTS);
};
