import type { BankCardLine } from "./bank.ts";
import { normalizeName } from "./cards.ts";
import { diffDays, type LocalDate } from "./date.ts";

/**
 * Card purchases the phone read from the bank app's notification (specs/002, "Compras na hora").
 * Open Finance brings the same charge hours or days later, and is the check on every read: a bank
 * app's reads move the ceiling only after the bank confirmed the last PHONE_TRUST_AFTER of them in
 * a row, and one read the bank never brought sends that bank back to learning. Reads never become
 * a line of the sheet: the bank's charge does, through Para lançar.
 */

/** How far apart the notification's day and the bank's date of the same charge may be. */
export const PHONE_MATCH_DAYS = 3;
/** Reads in a row the bank must confirm before the ceiling counts that bank app's reads. */
export const PHONE_TRUST_AFTER = 3;
/**
 * How long the bank has to bring a read purchase: read this many days later without it, the read
 * was wrong (a debit or a refused purchase taken for a credit one, a wrong amount or card).
 */
export const PHONE_WAIT_DAYS = 5;
/** Two notices of the same purchase (two apps of one bank, or one posted twice) come this close. */
export const PHONE_SAME_MINUTES = 10;

/** A purchase the phone read, placed on its card's bill. */
export interface PhoneRead extends BankCardLine {
  /** The bank whose app told it: a bank's reads earn the trust together. */
  readonly bank: string;
  readonly date: LocalDate;
  /** The last day Open Finance read the card's bank; null before it ever did. */
  readonly bankReadOn: LocalDate | null;
}

/** How far the bank confirmed one bank app's reads, for Ajustes. */
export interface PhoneTrust {
  readonly bank: string;
  /** Reads the bank confirmed in a row, since the last one it never brought. */
  readonly confirmed: number;
  /** The ceiling counts this bank app's reads. */
  readonly trusted: boolean;
}

type Verdict = "confirmed" | "missed" | "waiting";

/**
 * Each read against the bank's charges, oldest first: the purchases the ceiling counts now (reads
 * of a trusted bank the bank has not brought yet), and each bank's trust.
 */
export const phoneReads = (
  reads: readonly PhoneRead[],
  bank: readonly BankCardLine[],
): { provisional: BankCardLine[]; trust: PhoneTrust[] } => {
  const ordered = [...reads].sort((a, b) => diffDays(b.date, a.date));
  const taken = new Set<number>();
  const verdicts = ordered.map((p): Verdict => {
    const i = bank.findIndex(
      (l, at) =>
        !taken.has(at) &&
        l.amount === p.amount &&
        normalizeName(l.card) === normalizeName(p.card) &&
        l.date !== undefined &&
        Math.abs(diffDays(l.date, p.date)) <= PHONE_MATCH_DAYS,
    );
    if (i >= 0) {
      taken.add(i);
      return "confirmed";
    }
    return p.bankReadOn !== null && diffDays(p.date, p.bankReadOn) >= PHONE_WAIT_DAYS
      ? "missed"
      : "waiting";
  });
  const streak = new Map<string, number>();
  ordered.forEach((p, i) => {
    const now = streak.get(p.bank) ?? 0;
    if (verdicts[i] === "confirmed") streak.set(p.bank, now + 1);
    else if (verdicts[i] === "missed") streak.set(p.bank, 0);
    else streak.set(p.bank, now);
  });
  const trusted = (bank: string) => (streak.get(bank) ?? 0) >= PHONE_TRUST_AFTER;
  return {
    provisional: ordered
      .filter((p, i) => verdicts[i] === "waiting" && trusted(p.bank))
      .map(({ bank: _, bankReadOn: __, ...l }) => l),
    trust: [...streak].map(([bank, confirmed]) => ({
      bank,
      confirmed,
      trusted: trusted(bank),
    })),
  };
};

/**
 * One read per purchase: the same bank, amount and card a few minutes apart is one purchase told
 * twice (Bradesco's two apps both notify it). The read that names the card's digits is kept.
 */
export const onePerPurchase = <
  T extends {
    readonly bank: string;
    readonly amount: number;
    readonly last4: string | null;
    readonly at: string;
  },
>(
  reads: readonly T[],
): T[] => {
  const kept: T[] = [];
  for (const r of reads) {
    const twin = kept.findIndex(
      (k) =>
        k.bank === r.bank &&
        k.amount === r.amount &&
        (k.last4 === null || r.last4 === null || k.last4 === r.last4) &&
        Math.abs(Date.parse(k.at) - Date.parse(r.at)) <= PHONE_SAME_MINUTES * 60_000,
    );
    if (twin < 0) kept.push(r);
    else if (kept[twin]?.last4 === null && r.last4 !== null) kept[twin] = r;
  }
  return kept;
};
