import { buildPushPayload, type VapidKeys } from "@block65/webcrypto-web-push";
import {
  add,
  addDays,
  type Cents,
  formatBRL,
  type LocalDate,
  sub,
  type UpcomingItem,
  weekday,
  ZERO,
} from "@neko/engine";
import { SheetStructureError } from "@neko/sheet-reader";
import { sheetCellUrl } from "../shared/sheet.ts";
import { bankText } from "../shared/text.ts";
import type { ProjectionResponse } from "../shared/types.ts";
import { IDLE_DAYS } from "./auth.ts";
import type { Env } from "./env.ts";

/**
 * What Neko notifies (specs/002, "Notificações"): at most a morning and an evening message, each
 * only when there is something to do, plus the rare alert. Facts in the sheet's and the bank's
 * own numbers, never a forecast and never a scolding.
 */
export interface Reminder {
  readonly title: string;
  readonly body: string;
  /** Opened when the notification is tapped: "/" is Hoje, PARA_LANCAR its Para lançar. */
  readonly url: string;
  /** Same tag replaces the previous notification instead of stacking. */
  readonly tag: "morning" | "evening" | "alert";
}

/** Hoje, scrolled to Para lançar: the web reads the hash, the Android app its own action. */
export const PARA_LANCAR = "/#para-lancar";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const shortDate = (iso: string) =>
  `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
// Intl puts a non-breaking space after R$; a plain space reads the same in a notification.
const money = (c: Cents) => formatBRL(c).replace(/\s/g, " ");
/** "a, b e c", as a sentence lists things. */
const listOf = (items: readonly string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} e ${items.at(-1)}`;

type Projection = ProjectionResponse["projection"];

/** The sheet's balance at the end of a day; null outside the months it has. */
const balanceOn = (p: Projection, date: string) =>
  p.months
    ?.find((m) => m.year === Number(date.slice(0, 4)) && m.month === Number(date.slice(5, 7)))
    // Missing on projections cached before the termômetro existed.
    ?.days?.find((d) => d.day === Number(date.slice(8, 10)))?.balance ?? null;

/** What leaves the account on a day, as the sheet names it: bills and card bills. */
const dueOn = (p: Projection, date: string) =>
  (p.upcoming ?? []).filter((u) => u.kind !== "income" && u.date === date);
const billName = (u: UpcomingItem) =>
  u.kind === "card" ? `fatura do ${u.description}` : u.description;
const billText = (u: UpcomingItem) => `${billName(u)} ${money(u.amount)}`;
/** How much the account misses at the end of a day, when the sheet's balance goes below zero. */
const shortOn = (p: Projection, date: string): Cents | null => {
  const balance = balanceOn(p, date);
  return balance !== null && balance < 0 ? sub(ZERO, balance) : null;
};

/**
 * One reason for the morning message: its own title and body when it leads, one line when it
 * follows a more urgent one.
 */
interface Part {
  readonly title: string;
  readonly body: string;
  readonly line: string;
  readonly url: string;
}

/**
 * Every bill the sheet has for today, cards or not: in one morning the owner asked which bills to
 * pay, and two of five were not cards. When the day's balance ends below zero, the message says
 * how much the account misses to pay them, since a reminder of the bill alone moves the problem
 * into the overdraft (Medina, 2021).
 */
const billsPart = (p: Projection): Part | null => {
  const due = dueOn(p, p.today);
  const [first] = due;
  if (!first) return null;
  const short = shortOn(p, p.today);
  const missing = short === null ? "" : `Para pagar, faltam ${money(short)} na conta.`;
  const total = due.reduce((sum, u) => add(sum, u.amount), ZERO);
  const url = due.every((u) => u.kind === "card") ? "/faturas" : "/";
  return due.length === 1
    ? {
        title: `Vence hoje: ${billName(first)}, ${money(first.amount)}`,
        body: missing,
        line: `Vence hoje: ${billText(first)}.${missing ? ` ${missing}` : ""}`,
        url,
      }
    : {
        title: `Vencem hoje ${due.length} contas: ${money(total)}`,
        body: `${listOf(due.map(billText))}.${missing ? ` ${missing}` : ""}`,
        line: `Vencem hoje ${listOf(due.map(billText))}.${missing ? ` ${missing}` : ""}`,
        url,
      };
};

/** Days ahead the balance going red is announced: time to move money before the bill. */
const RED_AHEAD = 2;

/**
 * The balance below zero now, or within RED_AHEAD days. Further ahead it waits on Hoje: it is not
 * today's to do, and the same warning every morning stops being read (Yancey and Settles, 2020).
 * Today's bills already say what the account misses, so they make this one redundant.
 */
const redPart = (p: Projection): Part | null => {
  const red = (p.insights ?? []).find((i) => i.kind === "goes-negative");
  if (red?.kind !== "goes-negative") return null;
  const billsSayIt = dueOn(p, p.today).length > 0 && shortOn(p, p.today) !== null;
  if (red.already) {
    if (billsSayIt) return null;
    const short = shortOn(p, p.today);
    const body = short === null ? "" : `No fim de hoje, faltam ${money(short)} na conta.`;
    return { title: "O saldo está negativo", body, line: "O saldo está negativo.", url: "/" };
  }
  if (red.start > addDays(p.today, RED_AHEAD)) return null;
  if (red.start === p.today && billsSayIt) return null;
  const when = red.start === p.today ? "hoje" : `em ${shortDate(red.start)}`;
  const short = shortOn(p, red.start);
  const due = dueOn(p, red.start);
  const body = [
    short === null ? "" : `Faltam ${money(short)} na conta nesse dia.`,
    due.length === 0 ? "" : `Vence${due.length > 1 ? "m" : ""}: ${listOf(due.map(billText))}.`,
  ]
    .filter(Boolean)
    .join(" ");
  return {
    title: `O saldo fica negativo ${when}`,
    body,
    line: `O saldo fica negativo ${when}.${body ? ` ${body}` : ""}`,
    url: "/",
  };
};

/** On payday, the method's saving (see engine `saveable`) is the one thing worth doing first. */
const savingPart = (p: Projection): Part | null => {
  const s = p.saving;
  if (!s || s.date !== p.today) return null;
  return {
    title: `Hoje dá para guardar ${money(s.amount)}`,
    body: `Depois de guardar, o menor saldo até ${shortDate(s.until)} fica em ${money(s.leftAtLowest)}.`,
    line: `Hoje dá para guardar ${money(s.amount)}.`,
    url: "/",
  };
};

/** The ceiling's marks worth a message, once each in a month (see notices.ts `ceilingNews`). */
export type CeilingNews = 75 | 100;

/** The month's ceiling crossed 75% or 100% since the last time it was said. */
const ceilingPart = (p: Projection, news: CeilingNews | null): Part | null => {
  const cs = p.canSpend;
  if (news === null || cs?.mode !== "cards") return null;
  if (news === 75)
    return {
      title: "Cartões e Pix passaram de 75% do teto",
      body: `Ainda cabem ${money(cs.left)} até o fim do mês.`,
      line: `Cartões e Pix passaram de 75% do teto: ainda cabem ${money(cs.left)}.`,
      url: "/",
    };
  const title =
    cs.overBy > 0
      ? `Cartões e Pix passaram ${money(cs.overBy)} do teto`
      : "Cartões e Pix chegaram ao teto";
  return {
    title,
    body: `O teto do mês é ${money(cs.budget)}.`,
    line: `${title}.`,
    url: "/",
  };
};

/**
 * Sunday: the week that just closed, as facts. What cards and Pix took against the week before
 * (comparing with one's own past spending lowers it, Levi and Benartzi), and the days logged.
 */
const weekPart = ({ projection: p, habit, week }: ProjectionResponse): Part | null => {
  if (weekday(p.today as LocalDate) !== 0) return null;
  const logged = habit?.lastWeek ? `${habit.lastWeek} de 7 dias lançados` : null;
  if (!week) {
    if (!logged) return null;
    return {
      title: `Semana passada: ${logged}`,
      body: "",
      line: `Semana passada: ${logged}.`,
      url: "/",
    };
  }
  const diff = week.previous === null ? null : sub(week.total, week.previous);
  const versus =
    diff === null
      ? null
      : diff < 0
        ? `${money(sub(ZERO, diff))} a menos que na semana anterior`
        : diff > 0
          ? `${money(diff)} a mais que na semana anterior`
          : "o mesmo que na semana anterior";
  const spent = `${money(week.total)} em cartões e Pix`;
  const body = [versus, logged]
    .filter((x): x is string => x !== null)
    .map((x) => `${x.charAt(0).toUpperCase()}${x.slice(1)}.`)
    .join(" ");
  return {
    title: `Semana passada: ${spent}`,
    body,
    line: `Semana passada: ${[spent, versus, logged].filter(Boolean).join(", ")}.`,
    url: "/",
  };
};

/**
 * 08:00, only when there is something to do, the most urgent in the title: bills due today, the
 * balance going red, payday's saving, the ceiling crossing a mark, and on Sunday the week. What
 * still fits lives on the widget and Hoje, where it is seen without an interruption.
 */
export const morningMessage = (
  data: ProjectionResponse,
  ceiling: CeilingNews | null = null,
): Reminder | null => {
  const p = data.projection;
  const parts = [
    billsPart(p),
    redPart(p),
    savingPart(p),
    ceilingPart(p, ceiling),
    weekPart(data),
  ].filter((x): x is Part => x !== null);
  const [lead, ...rest] = parts;
  if (!lead) return null;
  return {
    title: lead.title,
    body: [lead.body, ...rest.map((r) => r.line)].filter(Boolean).join(" "),
    url: lead.url,
    tag: "morning",
  };
};

/** The run as a fact, not a threat. */
const streakLine = (streak: number) => (streak >= 2 ? ` Você está há ${streak} dias em dia.` : "");

/**
 * When yesterday went without a change, tonight's edit is what mends it, and the nudge leads with
 * that: a run that can be repaired keeps people going (Silverman and Barasch, 2023).
 */
const mendLine = (streak: number) =>
  `Ontem ficou sem lançar. Lance hoje e a sequência de ${streak} ${streak === 1 ? "dia" : "dias"} continua.`;

/** Items named in the evening message; the rest are counted. */
const NAMED = 3;

/**
 * The evening, at the owner's hour: what waits in Para lançar, by count and name, opening right
 * on it. With the queue empty, a nudge to log the day, quiet once the sheet changed today. With
 * writing off, nothing can be launched from Neko, so the nudge opens today's row in the sheet.
 */
export const eveningMessage = ({
  projection: p,
  sheet,
  habit,
  writing,
  bank,
}: ProjectionResponse): Reminder | null => {
  const queue = writing ? (bank?.queue ?? []) : [];
  const streak = habit?.streak ?? 0;
  const run = habit?.atRisk ? ` ${mendLine(streak)}` : streakLine(streak);
  if (queue.length > 0) {
    const names = queue.slice(0, NAMED).map((i) => bankText(i.title));
    const more = queue.length - names.length;
    return {
      title: `${queue.length} para lançar`,
      body: `${listOf(more > 0 ? [...names, `mais ${more}`] : names)}.${run}`,
      url: PARA_LANCAR,
      tag: "evening",
    };
  }
  if (p.todayLogged || habit?.editedToday) return null;
  return {
    title: "Lançou o dia?",
    body: habit?.atRisk
      ? mendLine(streak)
      : `${writing ? "Abre o Neko para lançar o dia" : `Abre a planilha direto no dia ${shortDate(p.today)}`}.${run}`,
    url:
      !writing && p.todayRef
        ? sheetCellUrl(sheet.id, sheet.tabs[p.todayRef.tab], p.todayRef.a1)
        : "/",
    tag: "evening",
  };
};

export const vapidKeys = (env: Env): VapidKeys | null =>
  env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
    ? {
        subject: "mailto:neko@joaoaraxaiba.workers.dev",
        publicKey: env.VAPID_PUBLIC_KEY,
        privateKey: env.VAPID_PRIVATE_KEY,
      }
    : null;

interface Row {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Subscriptions whose device is still signed in: a signed-out or expired session gets no more
 * reminders, which carry balances. Rows saved before subscriptions named their session (NULL)
 * still count until the app re-sends them.
 */
export const liveSubscriptions = async (db: D1Database, now: Date) => {
  const { results } = await db
    .prepare(
      `SELECT p.endpoint, p.p256dh, p.auth FROM push_subscription p
       WHERE p.session_id_hash IS NULL OR EXISTS (
         SELECT 1 FROM session s
         WHERE s.id_hash = p.session_id_hash AND s.expires_at > ? AND s.last_seen_at > ?
       )`,
    )
    .bind(now.toISOString(), new Date(now.getTime() - IDLE_DAYS * 86_400_000).toISOString())
    .all<Row>();
  return results;
};

/** When a scheduled read fails, the app keeps showing the last good one; this says so. */
export const readFailedMessage = (error: unknown): Reminder => ({
  title: "Não consegui ler a planilha",
  body:
    error instanceof SheetStructureError
      ? "Alguma aba ou coluna mudou de lugar. Os números do Neko são da última leitura."
      : "Tento de novo na próxima atualização. Os números do Neko são da última leitura.",
  url: "/",
  tag: "alert",
});

/** Sends one reminder to every subscribed browser; drops the ones the push service says are gone. */
export const sendReminder = async (env: Env, reminder: Reminder): Promise<void> => {
  const vapid = vapidKeys(env);
  if (!vapid) return;
  for (const row of await liveSubscriptions(env.DB, new Date())) {
    // One unreachable push service must not cost the other devices their reminder.
    try {
      const payload = await buildPushPayload(
        { data: JSON.stringify(reminder), options: { ttl: 6 * 3600, topic: reminder.tag } },
        {
          endpoint: row.endpoint,
          expirationTime: null,
          keys: { p256dh: row.p256dh, auth: row.auth },
        },
        vapid,
      );
      const res = await fetch(row.endpoint, payload);
      if (res.status === 404 || res.status === 410)
        await env.DB.prepare("DELETE FROM push_subscription WHERE endpoint = ?")
          .bind(row.endpoint)
          .run();
      else if (!res.ok) console.error("push failed", res.status);
    } catch (error) {
      console.error("push failed", error);
    }
  }
};
