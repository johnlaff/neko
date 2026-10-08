import { checkBalances } from "./balance.ts";
import { type Fixed, monthFixed, monthOutflows, type Outflow, UNITEMIZED } from "./breakdown.ts";
import {
  billOnSheet,
  type CardConfig,
  type Cycle,
  cycleContaining,
  isCardItem,
  normalizeName,
} from "./cards.ts";
import { addDays, diffDays, type LocalDate, parts, ymd } from "./date.ts";
import { type HealthIssue, missingBills, sheetHealth } from "./health.ts";
import { firstUnplannedMonth, type Insight, insights } from "./insights.ts";
import type { CellRef, Ledger, NoteItem } from "./ledger.ts";
import { add, type Cents, cents, divFloor, mul, sub, ZERO } from "./money.ts";
import { type MonthRecap, monthRecap } from "./recap.ts";
import { type Reserve, reserve, type YearTotals, yearTotals } from "./reserve.ts";
import { type Saving, saveable } from "./savings.ts";
import { type DayMove, type ThermoDay, thermometer } from "./thermometer.ts";

export interface Settings {
  /** Expected variable spending per day (the method's "diário"). Null: inferred from past bills. */
  readonly dailyForecast: Cents | null;
  /** Card whose cycle sets the pace in "Hoje cabem". Null: the card with the largest bills. */
  readonly usualCard: string | null;
  /** What you plan to spend on the usual card per cycle. Null: diário × days in the cycle. */
  readonly cycleBudget: Cents | null;
  readonly cards: readonly CardConfig[];
  /** Cards someone else pays (e.g. a partner's card): left out of your spending pace. */
  readonly othersCards: readonly string[];
}

export interface CardView {
  readonly card: CardConfig;
  readonly cycle: Cycle;
  /** What the sheet already holds for this bill. */
  readonly onSheet: Cents;
  /** Days left in the cycle, today and the closing day included. */
  readonly closesInDays: number;
  /** Days from a purchase made today to the bill that pays it. */
  readonly payInDays: number;
  /** Day of the month right after closing: purchases then wait the longest to be paid. */
  readonly bestDay: number;
  /** The next such day, from today on: the day after this cycle closes. */
  readonly bestDate: LocalDate;
  readonly reimbursed: boolean;
  /** Paid by someone else, per settings. */
  readonly others: boolean;
  readonly usual: boolean;
}

export interface CanSpend {
  readonly card: string;
  readonly budget: Cents;
  readonly budgetSource: "configured" | "diario";
  readonly accumulated: Cents;
  readonly daysLeft: number;
  readonly perDay: Cents;
  readonly closing: LocalDate;
  /** When this bill leaves the account. */
  readonly due: LocalDate;
  readonly cycleDays: number;
  /** Share of the budget the cycle allows up to today, spread evenly over its days. */
  readonly paceExpected: Cents;
  /** paceExpected − accumulated: positive is room under the pace, negative is ahead of it. */
  readonly paceGap: Cents;
  /** How much the bill already passed the cycle budget; zero while under it. */
  readonly overBy: Cents;
}

export interface Simulation {
  readonly perDay: Cents;
  /** Budget left for the cycle after the purchase. */
  readonly remaining: Cents;
  readonly due: LocalDate;
}

/** A purchase made today on the usual card: what is left per day until the bill closes. */
export const simulatePurchase = (cs: CanSpend, amount: Cents): Simulation => {
  const remaining = sub(sub(cs.budget, cs.accumulated), amount);
  return { perDay: divFloor(remaining, cs.daysLeft), remaining, due: cs.due };
};

/** A closed bill of the usual card, as the sheet holds it. */
export interface PastBill {
  readonly due: LocalDate;
  readonly amount: Cents;
}

export interface SeriesPoint {
  readonly date: LocalDate;
  readonly sheet: Cents;
  /** Allowance for that day; outside the open cycle it falls back to the diário. */
  readonly canSpend: Cents | null;
}

export interface MonthView {
  readonly year: number;
  readonly month: number;
  readonly entrada: Cents;
  readonly saida: Cents;
  readonly diario: Cents;
  readonly sobra: Cents;
  readonly startBalance: Cents;
  /** The sheet's balance on the month's last day: Neko adds nothing of its own to it. */
  readonly endSheet: Cents;
  /**
   * endSheet minus startBalance: the method's "performance", whether the month made a profit or
   * a loss (aulas/02 … 03-aula-3-analises-e-cenarios [01:26]).
   */
  readonly result: Cents;
  /** The month's Saída by description, largest first. */
  readonly outflows: readonly Outflow[];
  readonly fixed: readonly Fixed[];
  /** Sum of `fixed`: what the month commits to before any day-to-day spending. */
  readonly fixedTotal: Cents;
  /** Every day of the month on the termômetro, in order. */
  readonly days: readonly ThermoDay[];
  /**
   * Saída lines under an `Investimento:` header: money kept, not spent. The method's Economia
   * (aulas/02 … 03-aula-3-analises-e-cenarios [18:58]).
   */
  readonly saved: Cents;
  /** saved / entrada as a whole percent, rounded; null without income. The method aims at 20–30%. */
  readonly savedShare: number | null;
  /** Saída plus diário minus what was saved: what the month cost to live (curso 05, aula 01). */
  readonly livingCost: Cents;
}

/** `Investimento:`, `INVESTIMENTOS` and the like, however the owner spells the header. */
const isSavingItem = (i: NoteItem): boolean => i.section?.startsWith("invest") ?? false;

export interface UpcomingItem {
  readonly date: LocalDate;
  readonly description: string;
  readonly amount: Cents;
  readonly kind: "card" | "bill" | "income";
}

/** One card line on a due date, as the sheet holds it. */
export interface BillLine {
  readonly due: LocalDate;
  readonly card: string;
  readonly amount: Cents;
  readonly reimbursed: boolean;
}

export interface Projection {
  readonly today: LocalDate;
  readonly balanceToday: Cents | null;
  /** Today's Data cell, to open the sheet right on today's row. */
  readonly todayRef: CellRef | null;
  /** Today's diário already has a value, so the day's spending is on the sheet. */
  readonly todayLogged: boolean;
  readonly dailyForecast: Cents;
  readonly dailyForecastSource: "configured" | "inferred";
  readonly canSpend: CanSpend | null;
  readonly cards: readonly CardView[];
  readonly series: readonly SeriesPoint[];
  readonly months: readonly MonthView[];
  readonly upcoming: readonly UpcomingItem[];
  /** Card lines due from 3 months before today to 3 months after, for the bills history. */
  readonly bills: readonly BillLine[];
  /** Up to 6 bills of the usual card before the open one, oldest first. */
  readonly history: readonly PastBill[];
  /** Mean of the non-empty bills in `history`; null when there is none. */
  readonly historyAverage: Cents | null;
  /** Open bill of the usual card, as on the sheet, minus historyAverage; null without history. */
  readonly openVsAverage: Cents | null;
  readonly health: readonly HealthIssue[];
  /** How much the flow lets you set aside on the next payday; null when it does not. */
  readonly saving: Saving | null;
  /** Actionable warnings, worst first; empty when all is calm. */
  readonly insights: readonly Insight[];
  /** The method's emergency reserve from the sheet's months; null before a month closed. */
  readonly reserve: Reserve | null;
  /** The Economia tab: each year's entradas and what was kept, oldest first. */
  readonly years: readonly YearTotals[];
  /** The month that just closed, during the first week of the next; null otherwise. */
  readonly recap: MonthRecap | null;
}

const SERIES_DAYS = 60;
const UPCOMING_DAYS = 7;
const HISTORY_BILLS = 6;

const averageOf = (xs: Cents[]): Cents | null =>
  xs.length === 0 ? null : cents(Math.round(add(...xs) / xs.length));

const REIMBURSE_WINDOW_DAYS = 15;

/**
 * Card lines someone else pays back: tagged `#reembolso` in the note, or matched by an Entrada
 * line of the same amount within 15 days of the due date (each Entrada pays back one line).
 * Either way they net to zero for your own spending.
 */
export const findReimbursed = (ledger: Ledger): Set<NoteItem> => {
  const out = new Set<NoteItem>();
  const used = new Set<NoteItem>();
  ledger.forEach((row, i) => {
    for (const item of row.saida.items) {
      if (!isCardItem(item) || item.amount === 0) continue;
      if (/#reembolso\b/i.test(item.description)) {
        out.add(item);
        continue;
      }
      // Same day first, then outward, so the closest Entrada wins.
      for (let k = 0; k <= REIMBURSE_WINDOW_DAYS; k++) {
        const match = [ledger[i + k], ledger[i - k]]
          .flatMap((r) => r?.entrada.items ?? [])
          .find((e) => e.amount === item.amount && !used.has(e));
        if (match) {
          used.add(match);
          out.add(item);
          break;
        }
      }
    }
  });
  return out;
};

/** Card lines that are not your own spending: paid back, or on a card someone else pays. */
export const notMyCardLines = (
  ledger: Ledger,
  othersCards: readonly string[],
  reimbursed: Set<NoteItem> = findReimbursed(ledger),
): Set<NoteItem> => {
  const others = new Set(othersCards.map(normalizeName));
  const out = new Set(reimbursed);
  for (const row of ledger)
    for (const i of row.saida.items)
      if (isCardItem(i) && others.has(normalizeName(i.description))) out.add(i);
  return out;
};

/** Average daily card spending over the last 3 full months before today, rounded up to reais. */
export const inferDailyForecast = (
  ledger: Ledger,
  today: LocalDate,
  notMine: Set<NoteItem> = findReimbursed(ledger),
): Cents => {
  const { year, month } = parts(today);
  const from = `${month <= 3 ? year - 1 : year}-${String(((month - 4 + 12) % 12) + 1).padStart(2, "0")}-01`;
  const to = `${year}-${String(month).padStart(2, "0")}-01`;
  let total = 0;
  let days = 0;
  for (const row of ledger) {
    if (row.date < from || row.date >= to) continue;
    days++;
    const skip = notMine;
    for (const item of row.saida.items)
      if (isCardItem(item) && !skip.has(item)) total += item.amount;
    total += row.diario.amount;
  }
  if (days === 0) return ZERO;
  return cents(Math.ceil(total / days / 100) * 100);
};

const pickUsualCard = (
  ledger: Ledger,
  cards: readonly CardConfig[],
  today: LocalDate,
  reimbursed: Set<NoteItem>,
) => {
  const totals = new Map<string, number>();
  for (const row of ledger) {
    if (row.date >= today || diffDays(row.date, today) > 120) continue;
    const skip = reimbursed;
    for (const item of row.saida.items) {
      if (!isCardItem(item) || skip.has(item)) continue;
      const key = normalizeName(item.description);
      totals.set(key, (totals.get(key) ?? 0) + item.amount);
    }
  }
  let best: CardConfig | null = null;
  for (const c of cards) {
    if (
      !best ||
      (totals.get(normalizeName(c.name)) ?? 0) > (totals.get(normalizeName(best.name)) ?? 0)
    )
      best = c;
  }
  return best;
};

/** A cell's note lines as moves, plus whatever part of its amount no line explains. */
const cellMoves = (
  cell: Ledger[number]["entrada"],
  kind: (i: NoteItem) => "income" | "bill" | "card",
): DayMove[] => {
  const moves: DayMove[] = cell.items
    .filter((i) => i.amount !== 0)
    .map((i) => ({ kind: kind(i), description: i.description, amount: i.amount }));
  const rest = sub(cell.amount, add(ZERO, ...cell.items.map((i) => i.amount)));
  if (rest !== 0)
    moves.push({
      kind: kind({ amount: rest, description: "", section: null }),
      description: "",
      amount: rest,
    });
  return moves;
};

export const project = (ledger: Ledger, today: LocalDate, settings: Settings): Projection => {
  const last = ledger.at(-1);
  if (!last) throw new Error("empty ledger");
  const byDate = new Map(ledger.map((r) => [r.date, r]));
  const computed = new Map(checkBalances(ledger).map((c) => [c.row.date, c.computed]));
  const sheetBalance = (d: LocalDate): Cents => byDate.get(d)?.saldo ?? computed.get(d) ?? ZERO;

  const others = new Set(settings.othersCards.map(normalizeName));
  const reimbursed = findReimbursed(ledger);
  const notMine = notMyCardLines(ledger, settings.othersCards, reimbursed);
  const dailyForecast = settings.dailyForecast ?? inferDailyForecast(ledger, today, notMine);
  const usual =
    (settings.usualCard &&
      settings.cards.find(
        (c) => normalizeName(c.name) === normalizeName(settings.usualCard ?? ""),
      )) ||
    pickUsualCard(ledger, settings.cards, today, notMine);

  const cards: CardView[] = settings.cards.map((card) => {
    const cycle = cycleContaining(card, today);
    const row = byDate.get(cycle.due);
    const onSheet = billOnSheet(ledger, card, cycle.due) ?? ZERO;
    const isUsual = usual !== null && normalizeName(card.name) === normalizeName(usual.name);
    const isReimbursed =
      row?.saida.items.some(
        (i) => reimbursed.has(i) && normalizeName(i.description) === normalizeName(card.name),
      ) ?? false;
    return {
      card,
      cycle,
      onSheet,
      closesInDays: diffDays(today, cycle.closing) + 1,
      payInDays: diffDays(today, cycle.due),
      bestDay: parts(addDays(cycle.closing, 1)).day,
      bestDate: addDays(cycle.closing, 1),
      reimbursed: isReimbursed,
      others: others.has(normalizeName(card.name)),
      usual: isUsual,
    };
  });

  let canSpend: CanSpend | null = null;
  const usualView = cards.find((c) => c.usual);
  if (usualView) {
    const cycleDays = diffDays(usualView.cycle.start, usualView.cycle.closing);
    const budget = settings.cycleBudget ?? mul(dailyForecast, cycleDays);
    const daysLeft = Math.max(1, usualView.closesInDays);
    const daysIn = Math.min(cycleDays, Math.max(0, cycleDays - daysLeft + 1));
    canSpend = {
      card: usualView.card.name,
      budget,
      budgetSource: settings.cycleBudget === null ? "diario" : "configured",
      accumulated: usualView.onSheet,
      daysLeft,
      perDay: divFloor(sub(budget, usualView.onSheet), daysLeft),
      closing: usualView.cycle.closing,
      due: usualView.cycle.due,
      cycleDays,
      paceExpected: divFloor(mul(budget, daysIn), cycleDays),
      paceGap: sub(divFloor(mul(budget, daysIn), cycleDays), usualView.onSheet),
      overBy: usualView.onSheet > budget ? sub(usualView.onSheet, budget) : ZERO,
    };
  }

  const history: PastBill[] = [];
  if (usualView) {
    let cycle = usualView.cycle;
    for (let i = 0; i < HISTORY_BILLS; i++) {
      cycle = cycleContaining(usualView.card, cycle.start);
      const amount = billOnSheet(ledger, usualView.card, cycle.due);
      if (amount === null) break;
      history.unshift({ due: cycle.due, amount });
    }
  }

  const series: SeriesPoint[] = [];
  for (let i = 0; i < SERIES_DAYS; i++) {
    const d = addDays(today, i);
    if (d > last.date) break;
    const inOpenCycle = canSpend !== null && d <= canSpend.closing;
    series.push({
      date: d,
      sheet: sheetBalance(d),
      canSpend: canSpend === null ? null : inOpenCycle ? canSpend.perDay : dailyForecast,
    });
  }

  const cardNames = settings.cards.map((c) => c.name);
  const months: MonthView[] = [];
  for (const row of ledger) {
    const { year, month } = parts(row.date);
    let m = months.at(-1);
    if (!m || m.year !== year || m.month !== month) {
      const prev = addDays(row.date, -1);
      const fixed = monthFixed(ledger, year, month, cardNames);
      m = {
        year,
        month,
        entrada: ZERO,
        saida: ZERO,
        diario: ZERO,
        sobra: ZERO,
        startBalance: byDate.has(prev)
          ? sheetBalance(prev)
          : sub(
              sheetBalance(row.date),
              sub(row.entrada.amount, add(row.saida.amount, row.diario.amount)),
            ),
        endSheet: ZERO,
        result: ZERO,
        outflows: monthOutflows(ledger, year, month, cardNames, settings.othersCards),
        fixed,
        fixedTotal: add(ZERO, ...fixed.map((f) => f.amount)),
        days: [],
        saved: ZERO,
        savedShare: null,
        livingCost: ZERO,
      };
      months.push(m);
    }
    const entrada = add(m.entrada, row.entrada.amount);
    const saida = add(m.saida, row.saida.amount);
    const diario = add(m.diario, row.diario.amount);
    const saved = add(m.saved, ...row.saida.items.filter(isSavingItem).map((i) => i.amount));
    const balance = sheetBalance(row.date);
    const moves: DayMove[] = [
      ...cellMoves(row.entrada, () => "income"),
      ...cellMoves(row.saida, (i) => (isCardItem(i) ? "card" : "bill")),
      ...(row.diario.amount !== 0
        ? [{ kind: "diario" as const, description: "", amount: row.diario.amount }]
        : []),
    ];
    months[months.length - 1] = {
      ...m,
      days: [
        ...m.days,
        {
          day: parts(row.date).day,
          balance,
          band: thermometer(balance),
          future: row.date > today,
          moves,
        },
      ],
      entrada,
      saida,
      diario,
      sobra: sub(entrada, add(saida, diario)),
      endSheet: balance,
      result: sub(balance, m.startBalance),
      saved,
      savedShare: entrada > 0 ? Math.round((saved * 100) / entrada) : null,
      livingCost: sub(add(saida, diario), saved),
    };
  }

  const upcoming: UpcomingItem[] = [];
  for (let i = 0; i < UPCOMING_DAYS; i++) {
    const row = byDate.get(addDays(today, i));
    if (!row) break;
    // A bill someone pays back the same day (same name, same amount) nets to zero: nothing to do.
    const key = (i: NoteItem) => `${normalizeName(i.description)}|${i.amount}`;
    const backIn = new Set(row.entrada.items.map(key));
    const paidOut = new Set(row.saida.items.map(key));
    for (const item of row.saida.items) {
      if (item.amount === 0 || backIn.has(key(item))) continue;
      upcoming.push({
        date: row.date,
        description: item.description,
        amount: item.amount,
        kind: isCardItem(item) ? "card" : "bill",
      });
    }
    for (const item of row.entrada.items) {
      if (item.amount === 0 || paidOut.has(key(item))) continue;
      upcoming.push({
        date: row.date,
        description: item.description,
        amount: item.amount,
        kind: "income",
      });
    }
    // What the cell holds beyond its note lines still moves the balance, so it is listed too.
    const rest = (c: typeof row.saida) => sub(c.amount, add(ZERO, ...c.items.map((i) => i.amount)));
    const outRest = rest(row.saida);
    if (outRest > 0)
      upcoming.push({ date: row.date, description: UNITEMIZED, amount: outRest, kind: "bill" });
    const inRest = rest(row.entrada);
    if (inRest > 0)
      upcoming.push({ date: row.date, description: UNITEMIZED, amount: inRest, kind: "income" });
  }

  const bills: BillLine[] = [];
  for (const row of ledger) {
    const d = diffDays(today, row.date);
    if (d < -100 || d > 100) continue;
    const skip = reimbursed;
    for (const item of row.saida.items) {
      if (!isCardItem(item) || item.amount === 0) continue;
      bills.push({
        due: row.date,
        card: item.description,
        amount: item.amount,
        reimbursed: skip.has(item),
      });
    }
  }

  const historyAverage = averageOf(history.filter((h) => h.amount !== 0).map((h) => h.amount));

  const unplanned = firstUnplannedMonth(months, today);
  const plannedUntil = unplanned && ymd(unplanned.year, unplanned.month, 1);

  const view: Omit<Projection, "insights"> = {
    today,
    balanceToday: byDate.has(today) ? sheetBalance(today) : null,
    todayRef: byDate.get(today)?.dateRef ?? null,
    todayLogged: (byDate.get(today)?.diario.amount ?? 0) !== 0,
    dailyForecast,
    dailyForecastSource: settings.dailyForecast === null ? "inferred" : "configured",
    canSpend,
    cards,
    series,
    months,
    upcoming,
    bills,
    history,
    historyAverage,
    openVsAverage:
      historyAverage === null || !usualView ? null : sub(usualView.onSheet, historyAverage),
    health: [...sheetHealth(ledger), ...missingBills(ledger, settings.cards, today)].sort((a, b) =>
      a.date.localeCompare(b.date),
    ),
    // Past a month with no spending on the sheet the balances are too rosy to save from.
    saving: saveable(
      ledger
        .filter((row) => row.date >= today && (plannedUntil === null || row.date < plannedUntil))
        .map((row) => ({
          date: row.date,
          balance: sheetBalance(row.date),
          income: row.entrada.amount,
        })),
    ),
    reserve: reserve(months, parts(today)),
    recap: monthRecap(months, today),
    years: [...new Set(months.map((m) => m.year))]
      .sort((a, b) => a - b)
      .map((y) => yearTotals(months, y)),
  };
  return { ...view, insights: insights(view) };
};

/** How the current month's projected end moved between the first and last reading. */
export const historyDelta = (points: readonly { monthEndProjected: Cents }[]): Cents | null => {
  const first = points[0];
  const last = points.at(-1);
  return first && last && first !== last
    ? sub(last.monthEndProjected, first.monthEndProjected)
    : null;
};

export interface UpcomingDay {
  readonly date: LocalDate;
  readonly items: readonly UpcomingItem[];
  /** Income minus everything else due that day. */
  readonly net: Cents;
}

/** Upcoming items grouped by date, in the order they arrive, with each day's net. */
export const groupUpcomingByDay = (items: readonly UpcomingItem[]): UpcomingDay[] => {
  const days: { date: LocalDate; items: UpcomingItem[]; net: Cents }[] = [];
  for (const item of items) {
    let day = days.at(-1);
    if (day?.date !== item.date) {
      day = { date: item.date, items: [], net: ZERO };
      days.push(day);
    }
    day.items.push(item);
    day.net = item.kind === "income" ? add(day.net, item.amount) : sub(day.net, item.amount);
  }
  return days;
};
