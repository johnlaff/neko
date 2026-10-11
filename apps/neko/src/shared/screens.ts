import {
  add,
  type BillCheck,
  type BillState,
  billState,
  type CardConfig,
  type Cents,
  cents,
  cycleForDueMonth,
  diffDays,
  type Fixed,
  fixedOf,
  type InstallmentSimulation,
  type InvoiceCard,
  type LocalDate,
  monthWins,
  normalizeName,
  type Outflow,
  outflowTrend,
  type Reserve,
  type Saving,
  simulateInstallments,
  sub,
  type ThermoDay,
  type TrendPoint,
  type Win,
  type YearTotals,
  ZERO,
} from "@neko/engine";
import type { PrevistoView, ProjectionResponse, UserSettings } from "./types.ts";

/**
 * Faturas, Mês and Ajustes ready to draw, for the Android app. Same rules as the site's screens
 * (web/screens/*.tsx): every filter, grouping and sort happens here, next to the tests, and the
 * app only formats.
 */

/** One line the bank has on a bill: a purchase, a refund or a parcel of an earlier purchase. */
export interface BankLineView {
  readonly description: string;
  readonly amount: number;
  /** The day of the charge; null in data read before it was kept. */
  readonly date: string | null;
  readonly installment: number | null;
  readonly installments: number | null;
}

/** One card's bill in a month: the sheet's amount, where it stands, and what the bank has on it. */
export interface InvoiceRow {
  readonly card: string;
  readonly due: string;
  readonly closing: string;
  /** As the sheet holds it: the row's value. */
  readonly amount: number;
  readonly state: BillState;
  /** Days until it closes, today included; 0 unless open. */
  readonly closesInDays: number;
  readonly closingEstimated: boolean;
  readonly others: boolean;
  readonly reimbursed: boolean;
  /** The bank's side of this bill; null without a bank, or once it is due. */
  readonly bank: {
    readonly amount: number;
    readonly parcels: number;
    /** bank − sheet. */
    readonly gap: number;
    readonly closed: boolean;
    /** The sheet should change; the only bank detail the row itself shows. */
    readonly disagrees: boolean;
    /** Everything the bank has listed is parcels of earlier purchases, so far. */
    readonly onlyParcels: boolean;
    readonly lines: readonly BankLineView[];
  } | null;
  /** The card's limit and what is free of it, as the bank last said; null without one. */
  readonly limit: { readonly limit: number; readonly available: number } | null;
  /** This card in each month shown, for its own history. */
  readonly history: readonly { readonly month: string; readonly amount: number }[];
}

/** Every card due in one month, with the month's total. */
export interface InvoiceMonthView {
  /** Due month, `yyyy-MM`. */
  readonly key: string;
  readonly total: number;
  /** Before today's month. */
  readonly past: boolean;
  /** After today's month: what the sheet already has, drawn as an outline. */
  readonly future: boolean;
  readonly cards: readonly InvoiceRow[];
  /** The month against the bank; null when the bank has none of its bills. */
  readonly bank: {
    /** Cards whose bill the bank disagrees with. */
    readonly disagree: number;
    /** Of the bank's amounts, parcels of earlier purchases and the rest. */
    readonly parcels: number;
    readonly fresh: number;
  } | null;
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

export interface InvoicesView {
  readonly today: string;
  readonly readAt: string;
  /** False when the sheet has no card at all. */
  readonly hasCards: boolean;
  /** Oldest first, each with the cards due in it. */
  readonly months: readonly InvoiceMonthView[];
  /** The month to open on: the next bill still to pay. */
  readonly current: string | null;
  /** Mean of the non-empty months before today's: the chart's dashed line. */
  readonly average: number | null;
  /** Longest wait first; empty with a single card of your own, where there is nothing to pick. */
  readonly buyToday: readonly BuyGroup[];
  /** Last bank read; null with no bank linked. */
  readonly bank: { readonly syncedAt: string | null } | null;
}

/** A bank card line for the screen: no card name (the row has it), no bill month (the month has it). */
const lineView = (l: BillCheck["lines"][number]): BankLineView => ({
  description: l.description,
  amount: l.amount,
  date: l.date ?? null,
  installment: l.installment,
  installments: l.installments,
});

export const invoicesView = (r: ProjectionResponse): InvoicesView => {
  const p = r.projection;
  const today = p.today;
  const nowKey = today.slice(0, 7);
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
  const checks = r.bank?.checks ?? [];
  const limits = r.bank?.limits ?? [];
  const views = new Map(p.cards.map((c) => [normalizeName(c.card.name), c]));
  const invoices = p.invoices ?? [];
  // A card the bank already charges for a month the sheet has nothing on yet still shows up.
  const months = invoices.map((m) => {
    const sheetRows: InvoiceCard[] = [...m.cards];
    for (const c of checks) {
      if (c.due.slice(0, 7) !== m.month) continue;
      if (sheetRows.some((x) => normalizeName(x.card) === normalizeName(c.card))) continue;
      const view = views.get(normalizeName(c.card));
      if (!view) continue;
      const { card } = view;
      const [y = 0, mo = 0] = m.month.split("-").map(Number);
      const cycle = cycleForDueMonth(card, y, mo);
      const state = billState(cycle, today as LocalDate);
      sheetRows.push({
        card: card.name,
        cycle,
        amount: cents(0),
        state,
        closesInDays: state === "open" ? diffDays(today as LocalDate, cycle.closing) + 1 : 0,
        closingEstimated: card.closingEstimated,
        reimbursed: false,
        others: view.others,
      });
    }
    return { ...m, cards: sheetRows.toSorted((a, b) => a.cycle.due.localeCompare(b.cycle.due)) };
  });
  const historyOf = (card: string) =>
    months.map((m) => ({
      month: m.month,
      amount: m.cards.find((c) => normalizeName(c.card) === normalizeName(card))?.amount ?? 0,
    }));
  return {
    today,
    readAt: r.sheet.readAt,
    hasCards: p.cards.length > 0,
    months: months.map((m): InvoiceMonthView => {
      const mine = checks.filter((c) => c.due.slice(0, 7) === m.month);
      const rows = m.cards.map((c): InvoiceRow => {
        const check = mine.find((x) => normalizeName(x.card) === normalizeName(c.card));
        const limit = limits.find((x) => normalizeName(x.card) === normalizeName(c.card));
        return {
          card: c.card,
          due: c.cycle.due,
          closing: c.cycle.closing,
          amount: c.amount,
          state: c.state,
          closesInDays: c.closesInDays,
          closingEstimated: c.closingEstimated,
          others: c.others,
          reimbursed: c.reimbursed,
          bank: check
            ? {
                amount: check.bank,
                parcels: check.parcels,
                gap: check.gap,
                closed: check.closed ?? false,
                disagrees: check.disagrees ?? check.gap > 0,
                onlyParcels: !check.closed && check.parcels > 0 && check.parcels === check.bank,
                lines: (check.lines ?? []).map(lineView),
              }
            : null,
          limit: limit ? { limit: limit.limit, available: limit.available } : null,
          history: historyOf(c.card),
        };
      });
      const parcels = add(ZERO, ...mine.map((c) => c.parcels));
      return {
        key: m.month,
        total: m.total,
        past: m.month < nowKey,
        future: m.month > nowKey,
        cards: rows,
        bank:
          mine.length === 0
            ? null
            : {
                disagree: rows.filter((x) => x.bank?.disagrees).length,
                parcels,
                fresh: sub(add(ZERO, ...mine.map((c) => c.bank)), parcels),
              },
      };
    }),
    current: p.invoiceMonth ?? null,
    average: p.invoicesAverage ?? null,
    buyToday: mine.length > 1 ? groups : [],
    bank: r.bank ? { syncedAt: r.bank.syncedAt } : null,
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
  /**
   * Each destination with its last months, opened by a tap on its line, and its fixed line when it
   * comes back every month or is an installment.
   */
  readonly outflows: readonly (Outflow & {
    readonly trend: readonly TrendPoint[];
    readonly fixed: Fixed | null;
  })[];
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
        fixed: fixedOf(o, m.fixed),
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
  /** The Diário previsto; null from a Worker that predates it. */
  readonly previsto: PrevistoView | null;
}

export const ajustesView = (r: ProjectionResponse, settings: UserSettings): AjustesView => ({
  settings,
  cards: r.cardsKnown,
  dailyAuto: r.projection.dailyForecast,
  previsto: r.previsto ?? null,
});
