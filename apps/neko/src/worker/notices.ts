import type { LocalDate } from "@neko/engine";
import type { ProjectionResponse } from "../shared/types.ts";
import type { Env } from "./env.ts";
import {
  type CeilingNews,
  ceilingReminder,
  eveningMessage,
  morningMessage,
  type Reminder,
  sendReminder,
} from "./push.ts";

/**
 * Getting Neko's messages to the owner's phone without a push service (specs/002,
 * "Notificações"). The browser gets push; the Android app asks the Worker at 08:00, at the
 * evening hour and every 3 hours with the widget, so what the server has to say waits here.
 */

/**
 * Messages born on the server, one of each kind per day (migrations/0015_notice.sql): the alerts,
 * and the ceiling crossing a mark when the bank brings the purchase.
 */
export type NoticeKind = "meu-pluggy" | "planilha" | "teto-75" | "teto-100";

export interface Notice extends Reminder {
  /** The kind and the day ("planilha:2026-11-11"): the app shows each id once. */
  readonly id: string;
}

/** A notice older than this is gone: the app has long picked it up, or its problem was solved. */
const KEEP_DAYS = 7;

const daysAgo = (now: Date, days: number) =>
  new Date(now.getTime() - days * 86_400_000).toISOString();

/**
 * Keeps a server-born alert for the Android app and pushes it to the browsers, once a day per
 * kind: a sheet that stays unreadable all day is one message, not one per read.
 */
export const raiseNotice = async (
  env: Env,
  kind: NoticeKind,
  today: LocalDate,
  reminder: Reminder,
  now = new Date(),
): Promise<void> => {
  const { meta } = await env.DB.prepare(
    "INSERT INTO notice (id, title, body, url, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING",
  )
    .bind(`${kind}:${today}`, reminder.title, reminder.body, reminder.url, now.toISOString())
    .run();
  if (meta.changes > 0) await sendReminder(env, reminder);
};

/** The problem is solved (a sheet read again, a new sign-in): the phone takes its alert down. */
export const clearNotices = async (db: D1Database, kind: NoticeKind): Promise<void> => {
  await db.prepare("DELETE FROM notice WHERE id LIKE ?").bind(`${kind}:%`).run();
};

/** What the phone should be showing now, oldest first; the ceiling's go with the bills. */
export const recentNotices = async (db: D1Database, now = new Date()): Promise<Notice[]> => {
  const { results } = await db
    .prepare("SELECT id, title, body, url FROM notice WHERE created_at > ? ORDER BY created_at, id")
    .bind(daysAgo(now, KEEP_DAYS))
    .all<Omit<Notice, "tag">>();
  return results.map((r) => ({ ...r, tag: r.id.startsWith("teto") ? "ceiling" : "alert" }));
};

export const pruneNotices = async (db: D1Database, now = new Date()): Promise<void> => {
  await db.prepare("DELETE FROM notice WHERE created_at <= ?").bind(daysAgo(now, KEEP_DAYS)).run();
};

const put = (db: D1Database, key: string, value: unknown) =>
  db
    .prepare(
      "INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
    )
    .bind(key, JSON.stringify(value))
    .run();

const get = async <T>(db: D1Database, key: string): Promise<T | null> => {
  const row = await db
    .prepare("SELECT value FROM setting WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  return row ? (JSON.parse(row.value) as T) : null;
};

/** The highest mark of the month's ceiling already said, and the day it was said. */
export interface CeilingSaid {
  readonly month: string;
  readonly mark: number;
  readonly day: LocalDate;
}

/**
 * Whether the ceiling has news: 75% or 100% crossed since the last time it was said, never twice
 * in a month and never lowered by a refund. `next` is what to keep, if new.
 */
export const ceilingStep = (
  said: CeilingSaid | null,
  today: LocalDate,
  used: 0 | 50 | 75 | 100,
): { readonly news: CeilingNews | null; readonly next: CeilingSaid | null } => {
  const month = today.slice(0, 7);
  const before = said?.month === month ? said : null;
  if ((used === 75 || used === 100) && used > (before?.mark ?? 0))
    return { news: used, next: { month, mark: used, day: today } };
  return { news: null, next: null };
};

const CEILING_KEY = "ceiling_said";

/** The ceiling's news in this read of the bank, kept so the next read does not say it again. */
export const ceilingNews = async (
  db: D1Database,
  data: ProjectionResponse,
): Promise<CeilingNews | null> => {
  const cs = data.projection.canSpend;
  if (cs?.mode !== "cards" || cs.used === undefined) return null;
  const { news, next } = ceilingStep(
    await get<CeilingSaid>(db, CEILING_KEY),
    data.projection.today as LocalDate,
    cs.used,
  );
  if (next) await put(db, CEILING_KEY, next);
  return news;
};

/**
 * After every read of the banks (06:00, the evening, a Pluggy webhook, Atualizar, a purchase the
 * phone saw): the ceiling crossing a mark goes out at once, by push to the browsers and to the
 * phone with its next ask.
 */
export const checkCeiling = async (env: Env, data: ProjectionResponse): Promise<void> => {
  const news = await ceilingNews(env.DB, data);
  const reminder = news && ceilingReminder(data.projection, news);
  if (news && reminder)
    await raiseNotice(env, `teto-${news}`, data.projection.today as LocalDate, reminder);
};

/** The hours the evening message can come at: after work, before the late-night launches. */
export const EVENING_HOURS = [19, 20, 21, 22, 23] as const;
export type EveningHour = (typeof EVENING_HOURS)[number];
export const DEFAULT_EVENING: EveningHour = 21;
const HOUR_KEY = "evening_hour";

const isEveningHour = (h: unknown): h is EveningHour => EVENING_HOURS.includes(h as EveningHour);

/** The evening hour the owner chose in Ajustes, the same for the browser and the phone. */
export const loadEveningHour = async (db: D1Database): Promise<EveningHour> => {
  const hour = await get<number>(db, HOUR_KEY);
  return isEveningHour(hour) ? hour : DEFAULT_EVENING;
};

export const saveEveningHour = async (db: D1Database, hour: EveningHour): Promise<void> => {
  await put(db, HOUR_KEY, hour);
};

/**
 * What one run of the evening crons does at the owner's hour: read the banks half an hour before,
 * so Para lançar is fresh when the message counts it, then send the message.
 */
export const eveningJob = (
  at: { readonly hour: number; readonly minute: number },
  hour: EveningHour,
): "banks" | "message" | null =>
  at.minute === 30 && at.hour === hour - 1
    ? "banks"
    : at.minute === 0 && at.hour === hour
      ? "message"
      : null;

/**
 * GET /api/reminders, for the Android app, which shows these itself: today's two messages (null
 * when one has nothing to say), its evening hour, and the server's messages it may not have
 * shown yet.
 */
export const remindersView = (
  data: ProjectionResponse,
  extra: { readonly eveningHour: EveningHour; readonly notices: readonly Notice[] },
) => ({
  morning: morningMessage(data),
  evening: eveningMessage(data),
  eveningHour: extra.eveningHour,
  notices: extra.notices,
});
