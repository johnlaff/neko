import { buildPushPayload, type VapidKeys } from "@block65/webcrypto-web-push";
import { formatBRL, sub } from "@neko/engine";
import { SheetStructureError } from "@neko/sheet-reader";
import { sheetCellUrl } from "../shared/sheet.ts";
import type { ProjectionResponse } from "../shared/types.ts";
import { IDLE_DAYS } from "./auth.ts";
import type { Env } from "./env.ts";

export interface Reminder {
  readonly title: string;
  readonly body: string;
  /** Opened when the notification is tapped. */
  readonly url: string;
  /** Same tag replaces the previous notification instead of stacking. */
  readonly tag: "morning" | "evening" | "alert";
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const shortDate = (iso: string) =>
  `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
const days = (n: number) => (n === 1 ? "1 dia" : `${n} dias`);
/** Only the balance going red earns a line in the push; the rest waits in the app. */
const redDay = (p: ProjectionResponse["projection"]) => {
  const red = (p.insights ?? []).find((i) => i.kind === "goes-negative");
  return red?.kind === "goes-negative" ? ` O saldo fica negativo em ${shortDate(red.start)}.` : "";
};
/** On payday, the method's saving (see engine `saveable`) is the one thing worth doing first. */
const savingDay = (p: ProjectionResponse["projection"]) =>
  p.saving && p.saving.date === p.today
    ? ` Dia de guardar: dá para separar ${money(p.saving.amount)}.`
    : "";
// Intl puts a non-breaking space after R$; a plain space reads the same in a notification.
const money = (c: Parameters<typeof formatBRL>[0]) => formatBRL(c).replace(/\s/g, " ");

const closingText = (cs: { closing: string; daysLeft: number }) =>
  cs.daysLeft === 1
    ? "A fatura fecha hoje."
    : `A fatura fecha em ${shortDate(cs.closing)}. Faltam ${days(cs.daysLeft)}.`;

/** 08:00: how much fits today on the usual card. */
export const morningMessage = ({ projection: p }: ProjectionResponse): Reminder | null => {
  const cs = p.canSpend;
  if (!cs) return null;
  if (cs.perDay < 0)
    return {
      title: `O ${cs.card} passou ${money(sub(cs.accumulated, cs.budget))} do plano do ciclo`,
      body: `${closingText(cs)}${redDay(p)}${savingDay(p)}`,
      url: "/",
      tag: "morning",
    };
  return {
    title: `Hoje cabem ${money(cs.perDay)} no ${cs.card}`,
    body: `${cs.daysLeft === 1 ? "A fatura fecha hoje." : `Até a fatura fechar em ${shortDate(cs.closing)}. Faltam ${days(cs.daysLeft)}.`}${redDay(p)}${savingDay(p)}`,
    url: "/",
    tag: "morning",
  };
};

/** 21:00: the habit nudge, straight to today's row in the sheet; silent once the day is logged. */
export const eveningMessage = ({ projection: p, sheet }: ProjectionResponse): Reminder | null =>
  p.todayLogged
    ? null
    : {
        title: "Lançou os gastos de hoje?",
        body: `Abre a planilha direto no dia ${shortDate(p.today)}.`,
        url: p.todayRef ? sheetCellUrl(sheet.id, sheet.tabs[p.todayRef.tab], p.todayRef.a1) : "/",
        tag: "evening",
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
  }
};
