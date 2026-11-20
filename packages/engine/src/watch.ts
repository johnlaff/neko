import { type BankCardLine, isCardPayment } from "./bank.ts";
import { normalizeName } from "./cards.ts";
import { diffDays, type LocalDate } from "./date.ts";
import { type Cents, cents } from "./money.ts";
import { storeOf } from "./owners.ts";
import { isFee } from "./subscriptions.ts";

/**
 * The daily watch (specs/004-mia, "A vigia diária"): after the banks are read at 06:00, simple
 * rules look at the owner's card lines for what deserves a look today. Only charges already made; nothing is
 * predicted, and nothing reaches the sheet. Subscriptions out of their pattern are
 * `subscriptionNews`; this adds a charge that came twice and money a card gave back.
 *
 * Left out, for want of data: a purchase the card refused (Open Finance only lists what went
 * through) and "a store never seen" (on real bills it flags a few new places a week).
 */
export interface WatchNews {
  readonly kind: "repetida" | "estorno";
  /** Kind, store, value, card and first day: the same news is said once. */
  readonly key: string;
  /** The bank's text of the newest line. */
  readonly description: string;
  readonly card: string;
  /** The value of each repeated charge, or of the refund; always positive. */
  readonly amount: Cents;
  /** Every day the charge came, oldest first; the refund's single day. */
  readonly dates: readonly LocalDate[];
  /** The newest of `dates`. */
  readonly date: LocalDate;
  /** The bank's credit for a disputed charge ("CRED EM C/C CONTESTACAO"). */
  readonly dispute: boolean;
}

/** News stops being news after a week, as with subscriptions. */
const NEWS_DAYS = 7;
/** Below this, two of the same on one day are usually two (two rides, two coffees). */
export const REPEAT_MIN = cents(20_00);
/** At most this many days between two charges for them to read as one charged twice. */
const REPEAT_GAP = 1;
/** Some banks book the credit of a dispute as a line sending it to the account, with a plus. */
const DISPUTE = /contesta/i;

type Dated = BankCardLine & { readonly date: LocalDate };

const byDate = (a: { date: LocalDate }, b: { date: LocalDate }) =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : 0;

export const watchNews = (
  lines: readonly BankCardLine[],
  today: LocalDate,
  othersCards: readonly string[],
): WatchNews[] => {
  const others = new Set(othersCards.map(normalizeName));
  const fresh = (d: LocalDate) => {
    const age = diffDays(d, today);
    return age >= 0 && age <= NEWS_DAYS;
  };
  const own: Dated[] = lines.filter(
    (l): l is Dated =>
      l.date !== undefined &&
      diffDays(l.date, today) >= 0 &&
      !others.has(normalizeName(l.card)) &&
      !isFee(l.description),
  );
  const news: WatchNews[] = [];
  const key = (kind: string, store: string, l: Dated, amount: Cents, day: LocalDate) =>
    `${kind}|${store}|${amount}|${normalizeName(l.card)}|${day}`;

  // Refunds, and a dispute's credit whatever its sign; a bill's payment is neither.
  for (const l of own) {
    const dispute = DISPUTE.test(l.description);
    if (!fresh(l.date) || !(dispute || (l.amount < 0 && !isCardPayment(l)))) continue;
    const store = storeOf(l.description);
    const amount = cents(Math.abs(l.amount));
    news.push({
      kind: "estorno",
      key: key("estorno", store, l, amount, l.date),
      description: l.description,
      card: l.card,
      amount,
      dates: [l.date],
      date: l.date,
      dispute,
    });
  }

  // The same charge twice: one card, one store, one value, a day apart at most.
  const groups = new Map<string, Dated[]>();
  for (const l of own) {
    const store = storeOf(l.description);
    if (!store || l.amount < REPEAT_MIN || (l.installments ?? 1) > 1 || DISPUTE.test(l.description))
      continue;
    const k = `${normalizeName(l.card)}|${store}|${l.amount}`;
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  for (const group of groups.values()) {
    const runs: Dated[][] = [];
    for (const l of [...group].sort(byDate)) {
      const run = runs.at(-1);
      const prev = run?.at(-1);
      if (run && prev && diffDays(prev.date, l.date) <= REPEAT_GAP) run.push(l);
      else runs.push([l]);
    }
    for (const run of runs) {
      const [first] = run;
      const last = run.at(-1);
      if (run.length < 2 || !first || !last || !fresh(last.date)) continue;
      news.push({
        kind: "repetida",
        key: key("repetida", storeOf(first.description), first, first.amount, first.date),
        description: last.description,
        card: last.card,
        amount: first.amount,
        dates: run.map((l) => l.date),
        date: last.date,
        dispute: false,
      });
    }
  }
  return news.sort(byDate);
};
