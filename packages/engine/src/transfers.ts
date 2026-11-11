import { type BankMovement, isBillPayment } from "./bank.ts";
import { isCardItem, normalizeName } from "./cards.ts";
import { addDays, type LocalDate } from "./date.ts";
import type { Ledger } from "./ledger.ts";
import { add, type Cents, cents, sub, ZERO } from "./money.ts";

/**
 * A card bill the bank debits by itself leaves one account, not the sheet's whole Saldo: the
 * money can be in another of the owner's accounts and still miss the bill. These say which
 * account pays which cards, and what to move into it before the due day (specs/002,
 * "Notificações", item 8).
 */

/** A checking account and what the bank last read of it. */
export interface PayerAccount {
  readonly id: string;
  readonly label: string;
  /** The bank connection it came from: a bank debits its cards' bills from its own account. */
  readonly bank: string;
  readonly balance: Cents;
  readonly readOn: LocalDate | null;
}

/** A sheet card name and the bank connection its card account came from. */
export interface PayerCard {
  readonly bank: string;
  readonly card: string;
}

/** An account the bank debits card bills from, and the cards whose bills it pays. */
export interface BillPayer {
  readonly account: string;
  readonly label: string;
  readonly balance: Cents;
  readonly cards: readonly string[];
  /** The last bill payment it made, so a bill already taken is not asked for again. */
  readonly lastPaid: LocalDate;
}

/** How far back a bill payment still says which account pays: three months of bills. */
export const PAYER_DAYS = 100;

/**
 * The accounts that paid a card bill in the last PAYER_DAYS, each paying the cards of its own
 * bank. A bill paid by Pix from another bank leaves no such payment, and stays with the Saldo.
 * A balance not read since yesterday says nothing about today, so its account is left out.
 */
export const billPayers = (
  accounts: readonly PayerAccount[],
  cards: readonly PayerCard[],
  movements: readonly BankMovement[],
  today: LocalDate,
): BillPayer[] =>
  accounts.flatMap((a) => {
    if (a.readOn === null || a.readOn < addDays(today, -1)) return [];
    const paid = movements
      .filter(
        (m) =>
          m.account === a.id &&
          m.amount < 0 &&
          m.date >= addDays(today, -PAYER_DAYS) &&
          m.date <= today &&
          isBillPayment(m.description),
      )
      .map((m) => m.date)
      .sort();
    const lastPaid = paid.at(-1);
    const own = cards.filter((c) => c.bank === a.bank).map((c) => c.card);
    if (lastPaid === undefined || own.length === 0) return [];
    return [{ account: a.id, label: a.label, balance: a.balance, cards: own, lastPaid }];
  });

/** Days before the due day the move is asked for: time for a Pix, not yet a week of noise. */
export const TRANSFER_AHEAD = 2;

/** A bill paid up to this many days before its due day counts as this one, taken early. */
const EARLY_DAYS = 7;

export interface TransferDue {
  /** The account to move the money into. */
  readonly to: string;
  readonly amount: Cents;
  /** What the account has now. */
  readonly balance: Cents;
  /** The sheet's card lines it debits, holder and additional cards apart. */
  readonly bills: readonly {
    readonly card: string;
    readonly due: LocalDate;
    readonly amount: Cents;
  }[];
}

/**
 * What each paying account misses for the bills it debits from today to TRANSFER_AHEAD days on,
 * as the sheet holds them: the whole bill, someone's share paid back later included, since the
 * bank takes it all at once.
 */
export const transfersDue = (
  ledger: Ledger,
  payers: readonly BillPayer[],
  today: LocalDate,
): TransferDue[] => {
  const until = addDays(today, TRANSFER_AHEAD);
  const days = ledger.filter((r) => r.date >= today && r.date <= until);
  return payers.flatMap((p) => {
    const names = new Set(p.cards.map(normalizeName));
    const bills = days.flatMap((r) =>
      r.saida.items
        .filter((i) => isCardItem(i) && i.amount > 0 && names.has(normalizeName(i.description)))
        .filter(() => p.lastPaid < addDays(r.date, -EARLY_DAYS))
        .map((i) => ({ card: i.description, due: r.date, amount: i.amount })),
    );
    const total = add(ZERO, ...bills.map((b) => b.amount));
    if (bills.length === 0 || total <= p.balance) return [];
    return [{ to: p.label, amount: cents(sub(total, p.balance)), balance: p.balance, bills }];
  });
};
