import {
  type BankCardLine,
  type BankMovement,
  billChecks,
  type CardConfig,
  cents,
  type Ledger,
  type LocalDate,
  localDate,
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
  readonly bill_month: string | null;
  readonly card_number: string | null;
}

export interface BankBillRow {
  readonly id: string;
  readonly due_date: string;
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

export const bankInput = (rows: BankRows, map: UserSettings["bankCards"]) => {
  const cardAccounts = new Set(rows.accounts.filter((a) => a.type === "CREDIT").map((a) => a.id));
  const billMonth = new Map(rows.bills.map((b) => [b.id, b.due_date.slice(0, 7)]));
  const lines: BankCardLine[] = [];
  const movements: BankMovement[] = [];
  for (const t of rows.txns) {
    if (cardAccounts.has(t.account_id)) {
      const card = cardName(map, t.account_id, t.card_number);
      const month = t.bill_month ?? (t.bill_id ? billMonth.get(t.bill_id) : undefined);
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
      });
  }
  return { lines, movements };
};

/** Bank against sheet for the response; null with no bank linked. */
export const bankView = (
  rows: BankRows | null,
  ledger: Ledger,
  cards: readonly CardConfig[],
  settings: UserSettings,
  today: LocalDate,
): BankView | null => {
  if (!rows) return null;
  const { lines, movements } = bankInput(rows, settings.bankCards);
  return {
    syncedAt: rows.syncedAt,
    checks: billChecks(ledger, cards, lines, today),
    missing: unmatchedMovements(ledger, movements, today),
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
          "SELECT account_id, date, amount, type, description, installment, installments, bill_id, bill_month, card_number FROM bank_txn ORDER BY date, id",
        )
        .all<BankTxnRow>(),
      db.prepare("SELECT id, due_date FROM bank_bill").all<BankBillRow>(),
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
