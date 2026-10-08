import {
  type CardConfig,
  type Cents,
  type Fixed,
  type InstallmentSimulation,
  monthWins,
  type Outflow,
  outflowTrend,
  type Reserve,
  type Saving,
  simulateInstallments,
  type ThermoDay,
  type TrendPoint,
  type Win,
  type YearTotals,
} from "@neko/engine";
import type { ProjectionResponse, UserSettings } from "./types.ts";

/**
 * Faturas, Mês and Ajustes ready to draw, for the Android app. Same rules as the site's screens
 * (web/screens/*.tsx): every filter, grouping and sort happens here, next to the tests, and the
 * app only formats.
 */

export interface UsualBill {
  readonly card: string;
  readonly onSheet: number;
  readonly closing: string;
  readonly due: string;
  readonly closingEstimated: boolean;
  readonly closesInDays: number;
}

/** One column of the usual card's bill history; the open bill comes last. */
export interface BillBar {
  readonly due: string;
  readonly amount: number;
  readonly open: boolean;
}

/** Cards that charge a purchase made today on the same dates, read as one line. */
export interface BuyGroup {
  readonly cards: readonly string[];
  readonly payInDays: number;
  readonly due: string;
  /** Day after the closing, when a purchase waits the longest. */
  readonly bestDate: string;
  readonly estimated: boolean;
}

export interface OtherBill {
  readonly card: string;
  readonly onSheet: number;
  readonly due: string;
  readonly others: boolean;
  readonly reimbursed: boolean;
}

export interface InvoicesView {
  readonly today: string;
  readonly readAt: string;
  /** False when the sheet has no card at all. */
  readonly hasCards: boolean;
  readonly usual: UsualBill | null;
  /** Empty without a usual card or without closed bills to compare. */
  readonly history: readonly BillBar[];
  readonly historyAverage: number | null;
  readonly openVsAverage: number | null;
  /** Longest wait first; empty with a single card of your own, where there is nothing to pick. */
  readonly buyToday: readonly BuyGroup[];
  readonly others: readonly OtherBill[];
  /** Cards with nothing on their open bill. */
  readonly empty: readonly string[];
}

export const invoicesView = (r: ProjectionResponse): InvoicesView => {
  const p = r.projection;
  const usual = p.cards.find((c) => c.usual) ?? null;
  // Your own cards in use: the usual one, an open bill, or a bill in the last months.
  const mine = p.cards
    .filter(
      (c) =>
        !c.others && (c.usual || c.onSheet !== 0 || p.bills.some((b) => b.card === c.card.name)),
    )
    .toSorted((a, b) => b.payInDays - a.payInDays);
  const groups: BuyGroup[] = [];
  for (const c of mine) {
    const at = groups.findIndex((g) => g.due === c.cycle.due && g.bestDate === c.bestDate);
    const g = groups[at];
    if (g)
      groups[at] = {
        ...g,
        cards: [...g.cards, c.card.name],
        estimated: g.estimated || c.card.closingEstimated,
      };
    else
      groups.push({
        cards: [c.card.name],
        payInDays: c.payInDays,
        due: c.cycle.due,
        bestDate: c.bestDate,
        estimated: c.card.closingEstimated,
      });
  }
  return {
    today: p.today,
    readAt: r.sheet.readAt,
    hasCards: p.cards.length > 0,
    usual: usual && {
      card: usual.card.name,
      onSheet: usual.onSheet,
      closing: usual.cycle.closing,
      due: usual.cycle.due,
      closingEstimated: usual.card.closingEstimated,
      closesInDays: usual.closesInDays,
    },
    history:
      usual && p.history.length > 0
        ? [
            ...p.history.map((h) => ({ due: h.due, amount: h.amount, open: false })),
            { due: usual.cycle.due, amount: usual.onSheet, open: true },
          ]
        : [],
    historyAverage: p.historyAverage,
    openVsAverage: p.openVsAverage,
    buyToday: mine.length > 1 ? groups : [],
    others: p.cards
      .filter((c) => !c.usual && c.onSheet !== 0)
      .map((c) => ({
        card: c.card.name,
        onSheet: c.onSheet,
        due: c.cycle.due,
        others: c.others,
        reimbursed: c.reimbursed,
      })),
    empty: p.cards.filter((c) => !c.usual && c.onSheet === 0).map((c) => c.card.name),
  };
};

export interface MonthItem {
  /** `yyyy-MM`. */
  readonly key: string;
  readonly year: number;
  readonly month: number;
  /** Before the current month: closed, not a forecast. */
  readonly past: boolean;
  /** After the current month. */
  readonly future: boolean;
  readonly startBalance: number;
  readonly entrada: number;
  readonly saida: number;
  readonly diario: number;
  readonly endSheet: number;
  /** The method's performance; null on a month the sheet has no lines for. */
  readonly result: number | null;
  /** Each destination with its last months, opened by a tap on its line. */
  readonly outflows: readonly (Outflow & { readonly trend: readonly TrendPoint[] })[];
  readonly fixed: readonly Fixed[];
  readonly fixedTotal: number;
  /** The termômetro: each day's balance and band, with what moved it. */
  readonly days: readonly ThermoDay[];
  /** Saída under a `Reserva:` header, its share of entradas (whole %, null without income). */
  readonly saved: number;
  readonly savedShare: number | null;
  /** Saída plus diário minus what was saved. */
  readonly livingCost: number;
  /** What a closed month achieved, as its recap showed it; empty for the others. */
  readonly wins: readonly Win[];
}

export interface MonthsView {
  readonly today: string;
  readonly readAt: string;
  /** The month to open on: today's, or the first one when the sheet does not reach today. */
  readonly current: string | null;
  readonly months: readonly MonthItem[];
  /** Next payday's saving: the termômetro marks its day in that month. */
  readonly saving: Saving | null;
  /** The emergency reserve; null before a month closed. */
  readonly reserve: Reserve | null;
  /** The Economia tab, one entry per year. */
  readonly years: readonly YearTotals[];
}

const monthKey = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;

export const monthsView = (r: ProjectionResponse): MonthsView => {
  const p = r.projection;
  const nowKey = p.today.slice(0, 7);
  const months = p.months.map((m): MonthItem => {
    const key = monthKey(m.year, m.month);
    const moved = m.entrada !== 0 || m.saida !== 0 || m.diario !== 0;
    return {
      key,
      year: m.year,
      month: m.month,
      past: key < nowKey,
      future: key > nowKey,
      startBalance: m.startBalance,
      entrada: m.entrada,
      saida: m.saida,
      diario: m.diario,
      endSheet: m.endSheet,
      result: moved ? m.result : null,
      outflows: m.outflows.map((o) => ({
        ...o,
        trend: outflowTrend(p.months, m.year, m.month, o.label),
      })),
      fixed: m.fixed,
      fixedTotal: m.fixedTotal,
      days: m.days,
      saved: m.saved,
      savedShare: m.savedShare,
      livingCost: m.livingCost,
      wins: key < nowKey ? monthWins(p.months, m.year, m.month) : [],
    };
  });
  const current = months.find((m) => m.key === nowKey) ?? months[0];
  return {
    today: p.today,
    readAt: r.sheet.readAt,
    current: current?.key ?? null,
    months,
    saving: p.saving,
    reserve: p.reserve ?? null,
    years: p.years ?? [],
  };
};

/**
 * Hoje's "Simular compra": a purchase of `amount` today on the usual card in `count` parcels, as
 * the site's simulator computes it. Null when the sheet has no usual card to put it on.
 */
export const simulateView = (
  r: ProjectionResponse,
  amount: Cents,
  count: number,
): InstallmentSimulation | null =>
  r.projection.canSpend
    ? simulateInstallments(r.projection.canSpend, r.projection.months, amount, count)
    : null;

export interface AjustesView {
  readonly settings: UserSettings;
  /** Cards found in the sheet, with the closing day in use (estimated when not set). */
  readonly cards: readonly CardConfig[];
  /** The diário in use when the setting is empty, shown as the field's placeholder. */
  readonly dailyAuto: number;
}

export const ajustesView = (r: ProjectionResponse, settings: UserSettings): AjustesView => ({
  settings,
  cards: r.cardsKnown,
  dailyAuto: r.projection.dailyForecast,
});
