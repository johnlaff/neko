import {
  addDays,
  type BankCardLine,
  type BankMovement,
  billChecks,
  type CardConfig,
  type ClosedBill,
  cents,
  cycleContaining,
  type Ledger,
  type LocalDate,
  localDate,
  normalizeName,
  unmatchedMovements,
} from "@neko/engine";
import type { BankView, UserSettings } from "../shared/types.ts";

/**
 * What was read from the banks, as the engine takes it (specs/003-open-finance). Only the mapping
 * lives here: Pluggy's type to a sign, and each bank card to its name in the sheet.
 */

export interface BankAccountRow {
  readonly id: string;
  readonly type: string;
}

export interface BankTxnRow {
  readonly account_id: string;
  readonly date: string;
  readonly amount: number;
  readonly type: string;
  readonly description: string;
  readonly installment: number | null;
  readonly installments: number | null;
  readonly bill_id: string | null;
  readonly card_number: string | null;
}

export interface BankBillRow {
  readonly id: string;
  readonly account_id: string;
  readonly due_date: string;
  readonly total: number;
}

export interface BankRows {
  readonly items: number;
  readonly syncedAt: string | null;
  readonly accounts: readonly BankAccountRow[];
  readonly txns: readonly BankTxnRow[];
  readonly bills: readonly BankBillRow[];
}

const last4 = (s: string | null) => (s ? s.replace(/\D/g, "").slice(-4) : null);

/** The sheet's name for a card line: its own number first, then the card account as a whole. */
const cardName = (
  map: UserSettings["bankCards"],
  accountId: string,
  number: string | null,
): string | null =>
  map.find(
    (m) => m.accountId === accountId && m.cardNumber !== null && m.cardNumber === last4(number),
  )?.card ??
  map.find((m) => m.accountId === accountId && m.cardNumber === null)?.card ??
  null;

/** Pluggy's amount is unsigned in practice; its type says the direction. */
const signed = (t: BankTxnRow): number =>
  t.type === "CREDIT" ? Math.abs(t.amount) : -Math.abs(t.amount);

/**
 * The bill a card line lands on, by due month. A closed bill knows its due date. For the rest the
 * card's own cycle decides from the line's date: Pluggy's `billForecastDate` means a different
 * month at each bank (the closing month at one, the purchase month at another), so it is not used.
 */
export const bankInput = (
  rows: BankRows,
  map: UserSettings["bankCards"],
  cards: readonly CardConfig[],
) => {
  const config = new Map(cards.map((c) => [normalizeName(c.name), c]));
  const cardAccounts = new Set(rows.accounts.filter((a) => a.type === "CREDIT").map((a) => a.id));
  const billMonth = new Map(rows.bills.map((b) => [b.id, b.due_date.slice(0, 7)]));
  const lines: BankCardLine[] = [];
  const movements: BankMovement[] = [];
  for (const t of rows.txns) {
    if (cardAccounts.has(t.account_id)) {
      const card = cardName(map, t.account_id, t.card_number);
      const days = card ? config.get(normalizeName(card)) : undefined;
      const month =
        (t.bill_id ? billMonth.get(t.bill_id) : undefined) ??
        (days ? cycleContaining(days, localDate(t.date)).due.slice(0, 7) : undefined);
      if (!card || !month) continue;
      lines.push({
        card,
        // On a card a charge is a debit to you: positive here, as the engine counts a bill.
        amount: cents(-signed(t)),
        billMonth: month,
        description: t.description,
        installment: t.installment,
        installments: t.installments,
      });
    } else
      movements.push({
        date: localDate(t.date),
        amount: cents(signed(t)),
        description: t.description,
        account: t.account_id,
      });
  }
  // A closed bill's total is final, though the bank may leave a line or two out of the list. It
  // stands for the bill when the whole account is one card in the sheet; holder and additional
  // split it by their lines, so theirs stay summed.
  const closed: ClosedBill[] = rows.bills.flatMap((b) => {
    const names = new Set(map.filter((m) => m.accountId === b.account_id).map((m) => m.card));
    const [card] = names;
    return names.size === 1 && card
      ? [{ card, billMonth: b.due_date.slice(0, 7), total: cents(b.total) }]
      : [];
  });
  return { lines, movements, closed };
};

/** How far back a bank movement missing from the sheet is still shown. */
export const MISSING_DAYS = 40;

/** Bank against sheet for the response; null with no bank linked. */
export const bankView = (
  rows: BankRows | null,
  ledger: Ledger,
  cards: readonly CardConfig[],
  settings: UserSettings,
  today: LocalDate,
): BankView | null => {
  if (!rows) return null;
  const { lines, movements, closed } = bankInput(rows, settings.bankCards, cards);
  return {
    syncedAt: rows.syncedAt,
    checks: billChecks(ledger, cards, lines, today, closed),
    // The last MISSING_DAYS only, so an old gap does not stay on Hoje forever; the account id
    // stays on the server.
    missing: unmatchedMovements(ledger, movements, today)
      .filter((m) => m.date >= addDays(today, -MISSING_DAYS))
      .map(({ account: _, ...m }) => m),
  };
};

/**
 * Everything read from the banks, plus a version for the projection cache. Null when no bank is
 * linked, and also when the bank tables do not exist yet: the sheet's screens never depend on it.
 */
export const loadBank = async (db: D1Database): Promise<BankRows | null> => {
  try {
    const items = await db
      .prepare("SELECT COUNT(*) AS n, MAX(synced_at) AS at FROM bank_item")
      .first<{ n: number; at: string | null }>();
    if (!items || items.n === 0) return null;
    const [accounts, txns, bills] = await Promise.all([
      db.prepare("SELECT id, type FROM bank_account").all<BankAccountRow>(),
      db
        .prepare(
          "SELECT account_id, date, amount, type, description, installment, installments, bill_id, card_number FROM bank_txn ORDER BY date, id",
        )
        .all<BankTxnRow>(),
      db.prepare("SELECT id, account_id, due_date, total FROM bank_bill").all<BankBillRow>(),
    ]);
    return {
      items: items.n,
      syncedAt: items.at,
      accounts: accounts.results,
      txns: txns.results,
      bills: bills.results,
    };
  } catch (error) {
    console.error("bank tables unreadable", error);
    return null;
  }
};

/** Changes whenever a sync lands or a bank is linked or dropped. */
export const bankVersion = (rows: BankRows | null): string =>
  rows
    ? `${rows.items}:${rows.syncedAt ?? "-"}:${rows.accounts.length}:${rows.txns.length}`
    : "none";
