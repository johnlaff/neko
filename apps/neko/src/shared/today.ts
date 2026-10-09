import {
  addDays,
  type BankMovement,
  type CanSpend,
  groupUpcomingByDay,
  type Habit,
  type HealthIssue,
  type Insight,
  type MonthRecap,
  type Saving,
  type UpcomingDay,
} from "@neko/engine";
import { type QueueItemView, type SaldoView, saldoView } from "./queue.ts";
import { sheetCellUrl } from "./sheet.ts";
import type { DailySource, PrevistoView, ProjectionResponse } from "./types.ts";

/** Conferência looks back this far: older differences are history, not something to fix today. */
export const HEALTH_DAYS = 60;
/** Days before the payday the saving shows on Hoje: time to plan the transfer. */
export const SAVE_LEAD = 3;

/** Stable name of a Conferência point, kept in settings once checked. */
export const issueKey = (i: HealthIssue) => `${i.kind}|${i.date}|${i.ref.tab}!${i.ref.a1}`;

/** Where the usual card stands against its plan: past it, on pace, or ahead of the pace. */
export type Pace = "over" | "on-pace" | "ahead";

export const paceOf = (cs: CanSpend): Pace =>
  cs.perDay < 0 ? "over" : cs.paceGap >= 0 ? "on-pace" : "ahead";

export interface TodayIssue {
  readonly issue: HealthIssue;
  /** Opens the sheet on the cell the issue is about. */
  readonly url: string;
}

const brl = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A movement as a line of the sheet's day note: "R$ 19,90 - Padaria", the amount unsigned. */
export const noteLine = (m: BankMovement): string =>
  `R$ ${brl.format(Math.abs(m.amount) / 100)} - ${m.description.trim()}`;

export interface MissingMovement extends BankMovement {
  /** Ready to paste into the day's note, in the Entrada or the Saída column. */
  readonly line: string;
}

/**
 * Hoje, ready to draw: what the Android app and its widget show. Clients only format it; every
 * grouping, filter and sum is done here, next to the tests.
 */
export interface TodayView {
  readonly today: string;
  readonly balanceToday: number | null;
  readonly todayLogged: boolean;
  /** Opens the sheet on today's row; null when the sheet has no row for today. */
  readonly todayUrl: string | null;
  readonly canSpend: (CanSpend & { readonly pace: Pace }) | null;
  readonly dailyForecast: number;
  readonly dailySource: DailySource;
  readonly upcoming: readonly UpcomingDay[];
  readonly upcomingCount: number;
  readonly insights: readonly Insight[];
  /** The payday saving, only in the few days before it. */
  readonly saving: Saving | null;
  /** Conferência points of the last 60 days not yet marked as checked, newest first. */
  readonly issues: readonly TodayIssue[];
  /** All points in the window, checked or not: tells "all fine" from "only checked ones left". */
  readonly issuesInWindow: number;
  readonly readAt: string;
  /** Days the sheet changed, as a streak; null from a Worker that predates it. */
  readonly habit: Habit | null;
  /** The month that just closed, in the first week of the next. */
  readonly recap: MonthRecap | null;
  /** Account movements the sheet does not have yet; null with no bank linked. */
  readonly bankMissing: readonly MissingMovement[] | null;
  /** Para lançar; null with no bank linked. */
  readonly queue: readonly QueueItemView[] | null;
  /** "Saldo bate" against the bank, shown when the queue is empty. */
  readonly saldo: SaldoView | null;
  /** Off in Ajustes, or no writer key yet: the app shows no launch buttons. */
  readonly writing: boolean;
  /** Cards a purchase can be launched on: the closing day is known. */
  readonly entryCards: readonly string[];
  /** The Diário previsto, for its review every 3 months; null from an older Worker. */
  readonly previsto: PrevistoView | null;
}

export const todayView = (r: ProjectionResponse, reviewed: readonly string[]): TodayView => {
  const p = r.projection;
  const cellUrl = (tab: string, a1: string) => sheetCellUrl(r.sheet.id, r.sheet.tabs[tab], a1);
  const since = addDays(p.today, -HEALTH_DAYS);
  const inWindow = p.health.filter((i) => i.date >= since).reverse();
  const seen = new Set(reviewed);
  const saving =
    p.saving && p.saving.date >= p.today && p.saving.date <= addDays(p.today, SAVE_LEAD)
      ? p.saving
      : null;
  return {
    today: p.today,
    balanceToday: p.balanceToday,
    todayLogged: p.todayLogged,
    todayUrl: p.todayRef ? cellUrl(p.todayRef.tab, p.todayRef.a1) : null,
    canSpend: p.canSpend ? { ...p.canSpend, pace: paceOf(p.canSpend) } : null,
    dailyForecast: p.dailyForecast,
    dailySource: r.daily.source,
    upcoming: groupUpcomingByDay(p.upcoming),
    upcomingCount: p.upcoming.length,
    insights: p.insights ?? [],
    saving,
    issues: inWindow
      .filter((i) => !seen.has(issueKey(i)))
      .map((issue) => ({ issue, url: cellUrl(issue.ref.tab, issue.ref.a1) })),
    issuesInWindow: inWindow.length,
    readAt: r.sheet.readAt,
    habit: r.habit ?? null,
    recap: p.recap ?? null,
    bankMissing: r.bank ? r.bank.missing.map((m) => ({ ...m, line: noteLine(m) })) : null,
    queue: r.bank ? (r.bank.queue ?? []) : null,
    saldo: saldoView(r.bank?.saldo),
    writing: r.writing ?? false,
    entryCards: r.cardsKnown.filter((c) => !c.closingEstimated).map((c) => c.name),
    previsto: r.previsto ?? null,
  };
};
