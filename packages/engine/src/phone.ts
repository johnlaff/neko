import type { BankCardLine } from "./bank.ts";
import { normalizeName } from "./cards.ts";
import { diffDays, type LocalDate } from "./date.ts";

/**
 * Card purchases the phone read from the bank app's notification (specs/002, "Avisos de compra").
 * Open Finance brings the same charge hours or days later, and is the check on every read. For
 * now the reads only learn: a bank app's reads move the ceiling once it is released by hand, after
 * its real notices were checked, and while the bank confirmed its last PHONE_TRUST_AFTER reads in a
 * row; one read the bank never brought stops it again. Reads never become a line of the sheet: the
 * bank's charge does, through Para lançar.
 */

/** How far apart the notification's day and the bank's date of the same charge may be. */
export const PHONE_MATCH_DAYS = 3;
/** Reads in a row the bank must have confirmed for a released bank app's reads to count. */
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

/** How one bank app's reads fared against the bank, for Ajustes. */
export interface PhoneTrust {
  readonly bank: string;
  /** Reads the bank already judged: it brought them, or never did in PHONE_WAIT_DAYS. */
  readonly judged: number;
  /** Of those, the ones the bank brought: same card, same amount. */
  readonly matched: number;
  /** The ceiling counts this bank app's reads. */
  readonly trusted: boolean;
}

type Verdict = "confirmed" | "missed" | "waiting";

/**
 * Each read against the bank's charges, oldest first: the purchases the ceiling counts now (reads
 * of a trusted bank the bank has not brought yet), and how each bank app fared. `released`: the
 * bank apps whose reads may count at all, chosen by hand.
 */
export const phoneReads = (
  reads: readonly PhoneRead[],
  bank: readonly BankCardLine[],
  released: ReadonlySet<string>,
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
  const tally = new Map<string, { streak: number; judged: number; matched: number }>();
  ordered.forEach((p, i) => {
    const t = tally.get(p.bank) ?? { streak: 0, judged: 0, matched: 0 };
    if (verdicts[i] === "confirmed")
      tally.set(p.bank, { streak: t.streak + 1, judged: t.judged + 1, matched: t.matched + 1 });
    else if (verdicts[i] === "missed")
      tally.set(p.bank, { streak: 0, judged: t.judged + 1, matched: t.matched });
    else tally.set(p.bank, t);
  });
  const trusted = (bank: string) =>
    released.has(bank) && (tally.get(bank)?.streak ?? 0) >= PHONE_TRUST_AFTER;
  return {
    provisional: ordered
      .filter((p, i) => verdicts[i] === "waiting" && trusted(p.bank))
      .map(({ bank: _, bankReadOn: __, ...l }) => l),
    trust: [...tally].map(([bank, t]) => ({
      bank,
      judged: t.judged,
      matched: t.matched,
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
