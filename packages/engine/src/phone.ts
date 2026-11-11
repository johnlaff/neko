import type { BankCardLine } from "./bank.ts";
import { normalizeName } from "./cards.ts";
import { diffDays } from "./date.ts";

/**
 * Card purchases the phone read from the bank app's notification (specs/002, "Notificações",
 * item 11): they move the month's ceiling at once, and step aside when Open Finance brings the
 * same charge, hours or days later. They never become a line of the sheet by themselves.
 */

/** How far apart the notification's day and the bank's date of the same charge may be. */
export const PHONE_MATCH_DAYS = 3;

/** The purchases the bank has not brought yet: same card, same amount, close in time, one each. */
export const stillProvisional = (
  seen: readonly BankCardLine[],
  bank: readonly BankCardLine[],
): BankCardLine[] => {
  const taken = new Set<number>();
  return seen.filter((p) => {
    const i = bank.findIndex(
      (l, at) =>
        !taken.has(at) &&
        l.amount === p.amount &&
        normalizeName(l.card) === normalizeName(p.card) &&
        l.date !== undefined &&
        p.date !== undefined &&
        Math.abs(diffDays(l.date, p.date)) <= PHONE_MATCH_DAYS,
    );
    if (i < 0) return true;
    taken.add(i);
    return false;
  });
};
