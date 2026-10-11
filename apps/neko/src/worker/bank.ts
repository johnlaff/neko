import {
  addDays,
  type BankCardLine,
  type BankMovement,
  billChecks,
  buildQueue,
  type CardConfig,
  type ClosedBill,
  cents,
  cycleContaining,
  type Ledger,
  type LocalDate,
  localDate,
  normalizeName,
  saldoCheck,
  todayIn,
  unmatchedMovements,
} from "@neko/engine";
import { queueView } from "../shared/queue.ts";
import type { BankView, UserSettings } from "../shared/types.ts";

/**
 * What was read from the banks, as the engine takes it (specs/003-open-finance). Only the mapping
 * lives here: Pluggy's type to a sign, and each bank card to its name in the sheet.
 */

export interface BankAccountRow {
  readonly id: string;
  readonly type: string;
  readonly item_id?: string;
  readonly balance?: number;
  /** A card account's limit and what is still free of it, in cents; null when the bank says none. */
  readonly credit_limit?: number | null;
  readonly available_limit?: number | null;
}

export interface BankItemRow {
  readonly item_id: string;
  readonly label: string;
  readonly synced_at: string | null;
}

export interface BankTxnRow {
  /** The bank's own id when it has one: Pluggy may drop a movement and send it again anew. */
  readonly id?: string;
  readonly status?: string | null;
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
  readonly itemRows?: readonly BankItemRow[];
  /** Para lançar keys already launched or ignored. */
  readonly decided?: readonly string[];
  /** The ignored ones among them, so Para lançar can bring one back. */
  readonly ignored?: readonly string[];
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
  // The latest bill the bank listed, per account: a line it left off is on a later one.
  const lastListed = new Map<string, string>();
  for (const b of rows.bills) {
    const month = b.due_date.slice(0, 7);
    if (month > (lastListed.get(b.account_id) ?? "")) lastListed.set(b.account_id, month);
  }
  const after = (account: string, month: string) => {
    const last = lastListed.get(account);
    if (!last || month > last) return month;
    const [y = 0, m = 1] = last.split("-").map(Number);
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  };
  const lines: BankCardLine[] = [];
  const movements: BankMovement[] = [];
  for (const t of rows.txns) {
    if (cardAccounts.has(t.account_id)) {
      const card = cardName(map, t.account_id, t.card_number);
      const days = card ? config.get(normalizeName(card)) : undefined;
      const cycle =
        days && after(t.account_id, cycleContaining(days, localDate(t.date)).due.slice(0, 7));
      const month = (t.bill_id ? billMonth.get(t.bill_id) : undefined) ?? cycle;
      if (!card || !month) continue;
      lines.push({
        card,
        // On a card a charge is a debit to you: positive here, as the engine counts a bill.
        amount: cents(-signed(t)),
        billMonth: month,
        description: t.description,
        installment: t.installment,
        installments: t.installments,
        date: localDate(t.date),
      });
    } else if (t.status !== "PENDING")
      // Only what the bank confirmed: a pending movement waits.
      movements.push({
        date: localDate(t.date),
        amount: cents(signed(t)),
        description: t.description,
        account: t.account_id,
        ...(t.id ? { id: t.id } : {}),
      });
  }
  // A closed bill's total is final, though the bank may leave a line or two out of the list. With
  // holder and additional cards on one account, it is the total of all of them (billChecks).
  const closed: ClosedBill[] = rows.bills.flatMap((b) => {
    const names = [...new Set(map.filter((m) => m.accountId === b.account_id).map((m) => m.card))];
    return names.length > 0
      ? [{ cards: names, billMonth: b.due_date.slice(0, 7), total: cents(b.total) }]
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
  input: ReturnType<typeof bankInput> | null = rows && bankInput(rows, settings.bankCards, cards),
): BankView | null => {
  if (!rows || !input) return null;
  const { lines, movements, closed } = input;
  const labels = new Map((rows.itemRows ?? []).map((i) => [i.item_id, i]));
  const checking = rows.accounts.filter((a) => a.type !== "CREDIT");
  const accounts = checking.map((a) => ({
    id: a.id,
    label: labels.get(a.item_id ?? "")?.label ?? "Banco",
    use: settings.accountUse[a.id] ?? null,
  }));
  const ignored = new Set(rows.ignored ?? []);
  const built = buildQueue({
    ledger,
    cards,
    today,
    since: addDays(today, -MISSING_DAYS),
    movements,
    lines,
    closed,
    othersCards: settings.othersCards,
    accounts,
    savedOrigins: new Set(settings.savedOrigins),
    // Ignored items are built too, then set aside below, so they can be brought back.
    decided: new Set((rows.decided ?? []).filter((k) => !ignored.has(k))),
    forecast: settings.previstoSince !== null ? cents(settings.dailyForecast ?? 0) : null,
  });
  const queue = built.filter((i) => !ignored.has(i.key));
  const synced = (a: BankAccountRow) => labels.get(a.item_id ?? "")?.synced_at ?? null;
  return {
    syncedAt: rows.syncedAt,
    queue: queueView(queue, ledger, cards),
    ignored: built
      .filter((i) => ignored.has(i.key))
      .map((i) => ({
        key: i.key,
        date: i.date,
        title: queueView([i], ledger, cards)[0]?.title ?? "",
      })),
    saldo: saldoCheck(
      ledger,
      today,
      checking
        .filter((a) => settings.accountUse[a.id] !== "guardado")
        .map((a) => ({
          label: labels.get(a.item_id ?? "")?.label ?? "Banco",
          balance: cents(a.balance ?? 0),
          readOn: synced(a) ? todayIn(new Date(synced(a) as string)) : null,
        })),
    ),
    checks: billChecks(ledger, cards, lines, today, closed),
    // A holder and an additional card share one account, and so one limit.
    limits: rows.accounts.flatMap((a) =>
      a.type === "CREDIT" && a.credit_limit != null && a.available_limit != null
        ? [
            ...new Set(settings.bankCards.filter((m) => m.accountId === a.id).map((m) => m.card)),
          ].map((card) => ({
            card,
            limit: cents(a.credit_limit ?? 0),
            available: cents(a.available_limit ?? 0),
          }))
        : [],
    ),
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
    const [itemRows, accounts, txns, bills, decisions] = await Promise.all([
      db.prepare("SELECT item_id, label, synced_at FROM bank_item").all<BankItemRow>(),
      db
        .prepare(
          "SELECT id, type, item_id, balance, credit_limit, available_limit FROM bank_account",
        )
        .all<BankAccountRow>(),
      db
        .prepare(
          "SELECT COALESCE(provider_id, id) AS id, status, account_id, date, amount, type, description, installment, installments, bill_id, card_number FROM bank_txn ORDER BY date, id",
        )
        .all<BankTxnRow>(),
      db.prepare("SELECT id, account_id, due_date, total FROM bank_bill").all<BankBillRow>(),
      loadDecided(db),
    ]);
    return {
      items: items.n,
      syncedAt: items.at,
      itemRows: itemRows.results,
      decided: decisions.map((d) => d.key),
      ignored: decisions.filter((d) => d.state === "ignored").map((d) => d.key),
      accounts: accounts.results,
      txns: txns.results,
      bills: bills.results,
    };
  } catch (error) {
    console.error("bank tables unreadable", error);
    return null;
  }
};

/** Para lançar keys launched or ignored; none before migration 0009 is applied. */
const loadDecided = async (db: D1Database): Promise<{ key: string; state: string }[]> => {
  try {
    return (
      await db
        .prepare("SELECT key, state FROM queue_decision ORDER BY key")
        .all<{ key: string; state: string }>()
    ).results;
  } catch (error) {
    console.error("queue decisions unreadable", error);
    return [];
  }
};

/**
 * Changes whenever anything read from the banks changes: a hash of all of it, so a sync that
 * moves one value, or ignoring one item and bringing back another, never serves an old snapshot.
 */
export const bankVersion = (rows: BankRows | null): string => {
  if (!rows) return "none";
  // FNV-1a, 32 bits: a cache key, not security.
  const text = JSON.stringify(rows);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return `${rows.items}:${(h >>> 0).toString(36)}`;
};
