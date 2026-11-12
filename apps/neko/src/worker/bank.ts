import {
  addDays,
  type BankCardLine,
  type BankMovement,
  billChecks,
  billPayers,
  buildQueue,
  type CardConfig,
  type ClosedBill,
  cents,
  cycleContaining,
  ignoredGaps,
  type Ledger,
  type LocalDate,
  localDate,
  movedToday,
  normalizeName,
  onePerPurchase,
  type PhoneRead,
  phoneReads,
  type Statement,
  saldoCheck,
  subscriptions,
  todayIn,
  transfersDue,
  unmatchedMovements,
  withStatements,
} from "@neko/engine";
import { queueView } from "../shared/queue.ts";
import type { BankView, UserSettings } from "../shared/types.ts";
import { loadPhonePurchases, PHONE_RELEASED, type PhonePurchase } from "./phone.ts";

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
  /** When Meu Pluggy last read this bank (or Neko asked, before that was kept). */
  readonly read_at?: string | null;
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
  /** The day the bank closed it; older rows may not have it. */
  readonly close_date?: string | null;
  readonly total: number;
}

/** A line of the bank's own bill, read from its PDF (statement.ts). */
export interface StatementLineRow {
  readonly account_id: string;
  readonly bill_month: string;
  readonly card_number: string;
  readonly date: string;
  readonly description: string;
  readonly amount: number;
  readonly installment: number | null;
  readonly installments: number | null;
}

/** A closed bill known only from the bank's e-mail (inbox.ts), for a card outside Open Finance. */
export interface MailedBillRow {
  readonly card: string;
  readonly due_date: string;
  readonly total: number;
}

/** A biller's bill read from its e-mail (inbox.ts), before it is paid. */
export interface MailedContaRow {
  readonly biller: string;
  readonly due_date: string;
  readonly total: number;
  readonly read_at: string;
}

export interface BankRows {
  readonly items: number;
  /** When Meu Pluggy last read the bank read longest ago: how fresh the bank numbers are. */
  readonly syncedAt: string | null;
  readonly itemRows?: readonly BankItemRow[];
  /** Para lançar keys already launched or ignored. */
  readonly decided?: readonly string[];
  /** The ignored ones among them, so Para lançar can bring one back. */
  readonly ignored?: readonly string[];
  readonly accounts: readonly BankAccountRow[];
  readonly txns: readonly BankTxnRow[];
  readonly bills: readonly BankBillRow[];
  /** The bills read from the bank's PDFs, line by line; none before migration 0011. */
  readonly statements?: readonly StatementLineRow[];
  /** Bills known only from the bank's e-mail; none before migration 0012. */
  readonly mailedBills?: readonly MailedBillRow[];
  /** Light and phone bills known from the biller's e-mail; none before migration 0013. */
  readonly mailedContas?: readonly MailedContaRow[];
  /** Card purchases the phone read from the bank app; none before migration 0016. */
  readonly phone?: readonly PhonePurchase[];
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
  /** The bank apps whose phone reads may move the ceiling (phone.ts). */
  released: ReadonlySet<string> = PHONE_RELEASED,
) => {
  const config = new Map(cards.map((c) => [normalizeName(c.name), c]));
  const cardAccounts = new Set(rows.accounts.filter((a) => a.type === "CREDIT").map((a) => a.id));
  const billMonth = new Map(rows.bills.map((b) => [b.id, b.due_date.slice(0, 7)]));
  // The latest bill the bank listed, per account: a line it left off is on a later one, unless it
  // is from before that bill closed (the bank lists a bill before it ties its lines to it).
  const lastListed = new Map<string, { month: string; close: string | null }>();
  for (const b of rows.bills) {
    const month = b.due_date.slice(0, 7);
    if (month > (lastListed.get(b.account_id)?.month ?? ""))
      lastListed.set(b.account_id, { month, close: b.close_date ?? null });
  }
  // And when each listed bill closed: a line left off it from that day on is on the next one,
  // even once the bank lists a later bill (the closing day's purchases go to the next bill).
  const closes = new Map(rows.bills.map((b) => [`${b.account_id}|${b.due_date.slice(0, 7)}`, b]));
  const next = (month: string) => {
    const [y = 0, m = 1] = month.split("-").map(Number);
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  };
  const after = (account: string, month: string, date: string) => {
    const close = closes.get(`${account}|${month}`)?.close_date;
    if (close && date >= close) return next(month);
    const last = lastListed.get(account);
    if (!last || month > last.month) return month;
    if (last.close && date < last.close) return month;
    return next(last.month);
  };
  const lines: BankCardLine[] = [];
  const movements: BankMovement[] = [];
  // Pending checking movements: no item comes from them, but the bank's balance may already count
  // them (the saldo check, in bankView).
  const pending: BankMovement[] = [];
  for (const t of rows.txns) {
    if (cardAccounts.has(t.account_id)) {
      const card = cardName(map, t.account_id, t.card_number);
      const days = card ? config.get(normalizeName(card)) : undefined;
      const cycle =
        days &&
        after(
          t.account_id,
          cycleContaining(days, localDate(t.date)).due.slice(0, 7),
          localDate(t.date),
        );
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
    }
    // Only what the bank confirmed becomes an item: a pending movement waits.
    else
      (t.status === "PENDING" ? pending : movements).push({
        date: localDate(t.date),
        amount: cents(signed(t)),
        description: t.description,
        account: t.account_id,
        ...(t.id ? { id: t.id } : {}),
        ...(t.status === "PENDING" ? { pending: true } : {}),
      });
  }
  // A closed bill's total is final, though the bank may leave a line or two out of the list. With
  // holder and additional cards on one account, it is the total of all of them (billChecks), and
  // the card mapped to the account as a whole is the holder's.
  const closed: ClosedBill[] = rows.bills.flatMap((b) => {
    const names = [...new Set(map.filter((m) => m.accountId === b.account_id).map((m) => m.card))];
    const holder = map.find((m) => m.accountId === b.account_id && m.cardNumber === null)?.card;
    return names.length > 0
      ? [
          {
            cards: names,
            billMonth: b.due_date.slice(0, 7),
            total: cents(b.total),
            ...(holder ? { holder } : {}),
          },
        ]
      : [];
  });
  // A card outside Open Finance is known by its closing e-mail: its bill's total, its own alone.
  for (const b of rows.mailedBills ?? [])
    closed.push({
      cards: [b.card],
      billMonth: b.due_date.slice(0, 7),
      total: cents(b.total),
      holder: b.card,
    });
  // The bank's own bills fill in the lines the feed left out (statement.ts in the engine).
  const statements = new Map<string, Statement & { lines: BankCardLine[] }>();
  for (const r of rows.statements ?? []) {
    const card = cardName(map, r.account_id, r.card_number);
    if (!card) continue;
    const key = `${r.account_id}|${r.bill_month}`;
    const s = statements.get(key) ?? { billMonth: r.bill_month, lines: [] };
    s.lines.push({
      card,
      amount: cents(r.amount),
      billMonth: r.bill_month,
      description: r.description,
      installment: r.installment,
      installments: r.installments,
      date: localDate(r.date),
    });
    statements.set(key, s);
  }
  const all = withStatements(lines, [...statements.values()]);
  // A purchase the phone read lands on its card's bill like any other, by the same cycle, and is
  // checked against the bank's charges (engine phoneReads). Its card account: the one its last
  // digits are known on (Ajustes › Bancos, or a charge the bank brought before), else the only
  // card account of the linked bank whose label names it.
  const seen: PhoneRead[] = [];
  const credit = rows.accounts.filter((a) => a.type === "CREDIT");
  const itemReadAt = new Map(
    (rows.itemRows ?? []).map((i) => [i.item_id, i.read_at ?? i.synced_at]),
  );
  for (const p of onePerPurchase(rows.phone ?? [])) {
    const bank = normalizeName(p.bank);
    const items = new Set(
      (rows.itemRows ?? [])
        .filter((i) => normalizeName(i.label).includes(bank))
        .map((i) => i.item_id),
    );
    const ofBank = credit.filter((a) => items.has(a.item_id ?? ""));
    const byDigits =
      p.last4 === null
        ? undefined
        : (map.find((m) => m.cardNumber === p.last4)?.accountId ??
          rows.txns.find((t) => last4(t.card_number) === p.last4)?.account_id);
    const account =
      credit.find((a) => a.id === byDigits) ?? (ofBank.length === 1 ? ofBank[0] : undefined);
    const card = account && cardName(map, account.id, p.last4);
    const days = card ? config.get(normalizeName(card)) : undefined;
    if (!account || !card || !days) continue;
    const date = todayIn(new Date(p.at));
    const readAt = itemReadAt.get(account.item_id ?? "");
    seen.push({
      bank: p.bank,
      card,
      amount: cents(p.amount),
      billMonth: after(account.id, cycleContaining(days, date).due.slice(0, 7), date),
      description: p.merchant,
      installment: null,
      installments: null,
      date,
      bankReadOn: readAt ? todayIn(new Date(readAt)) : null,
    });
  }
  const phone = phoneReads(seen, all, released);
  return {
    lines: all,
    movements,
    pending,
    closed,
    /** Card purchases the phone read that the ceiling counts: the bank has not brought them yet. */
    provisional: phone.provisional,
    /** How each bank app's reads fared against the bank. */
    phoneTrust: phone.trust,
  };
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
  const { lines, movements, pending, closed } = input;
  const labels = new Map((rows.itemRows ?? []).map((i) => [i.item_id, i]));
  const checking = rows.accounts.filter((a) => a.type !== "CREDIT");
  const accounts = checking.map((a) => ({
    id: a.id,
    label: labels.get(a.item_id ?? "")?.label ?? "Banco",
    use: settings.accountUse[a.id] ?? null,
  }));
  const ignored = new Set(rows.ignored ?? []);
  const gaps = ignoredGaps(ignored);
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
    ignored,
    forecast: settings.previstoSince !== null ? cents(settings.dailyForecast ?? 0) : null,
    mailed: (rows.mailedContas ?? []).map((r) => ({
      biller: r.biller,
      due: localDate(r.due_date),
      total: cents(r.total),
      arrived: todayIn(new Date(r.read_at)),
    })),
  });
  const queue = built.filter((i) => !ignored.has(i.key));
  const synced = (a: BankAccountRow) => labels.get(a.item_id ?? "")?.synced_at ?? null;
  const moving = [...movements, ...pending];
  return {
    syncedAt: rows.syncedAt,
    queue: queueView(queue, ledger, cards),
    ignored: [
      ...built
        .filter((i) => ignored.has(i.key))
        .map((i) => ({
          key: i.key,
          date: i.date,
          title: queueView([i], ledger, cards)[0]?.title ?? "",
        })),
      ...ignoredBills(ignored, built, cards, today),
    ],
    saldo: saldoCheck(
      ledger,
      today,
      checking
        .filter((a) => settings.accountUse[a.id] !== "guardado")
        .map((a) => ({
          label: labels.get(a.item_id ?? "")?.label ?? "Banco",
          balance: cents(a.balance ?? 0),
          readOn: synced(a) ? todayIn(new Date(synced(a) as string)) : null,
          // A debit made today is off the balance even while the bank lists it as pending.
          today: movedToday(
            ledger,
            today,
            moving.filter((m) => m.account === a.id),
            moving,
          ),
        })),
      movements,
    ),
    // Faturas shows five months back: their bills keep what the bank had on them.
    checks: billChecks(ledger, cards, lines, today, closed, addDays(today, -160), gaps),
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
    subscriptions: subscriptionsView(lines, today, settings),
    owners: settings.owners,
    transfers: transfersDue(
      ledger,
      billPayers(
        checking
          .filter((a) => a.balance != null && settings.accountUse[a.id] !== "guardado")
          .map((a) => ({
            id: a.id,
            label: labels.get(a.item_id ?? "")?.label ?? "Banco",
            bank: a.item_id ?? a.id,
            balance: cents(a.balance ?? 0),
            readOn: synced(a) ? todayIn(new Date(synced(a) as string)) : null,
          })),
        settings.bankCards.flatMap((c) => {
          const bank = rows.accounts.find((a) => a.id === c.accountId)?.item_id;
          return bank ? [{ bank, card: c.card }] : [];
        }),
        [...movements, ...pending],
        today,
      ),
      today,
    ),
    phone: input.phoneTrust,
  };
};

/** Subscriptions with the owner's marks to cancel; a mark on one that stopped coming just drops. */
const subscriptionsView = (
  lines: readonly BankCardLine[],
  today: LocalDate,
  settings: UserSettings,
): NonNullable<BankView["subscriptions"]> => {
  const { items, total } = subscriptions(lines, today, settings.othersCards);
  const marked = new Set(settings.cancel);
  const view = items.map((i) => ({ ...i, cancel: marked.has(i.key) }));
  return {
    items: view,
    total,
    toCancel: cents(view.filter((i) => i.cancel).reduce((s, i) => s + i.amount, 0)),
  };
};

/**
 * Everything read from the banks, plus a version for the projection cache. Null when no bank is
 * linked, and also when the bank tables do not exist yet: the sheet's screens never depend on it.
 */
export const loadBank = async (db: D1Database): Promise<BankRows | null> => {
  try {
    const items = await db
      // How fresh the banks are: the one Meu Pluggy read longest ago, not when Neko last asked.
      .prepare(
        "SELECT COUNT(*) AS n, MIN(COALESCE(bank_updated_at, synced_at)) AS at FROM bank_item",
      )
      .first<{ n: number; at: string | null }>();
    if (!items || items.n === 0) return null;
    const [
      itemRows,
      accounts,
      txns,
      bills,
      decisions,
      statements,
      mailedBills,
      mailedContas,
      phone,
    ] = await Promise.all([
      db
        .prepare(
          "SELECT item_id, label, synced_at, COALESCE(bank_updated_at, synced_at) AS read_at FROM bank_item",
        )
        .all<BankItemRow>(),
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
      db
        .prepare("SELECT id, account_id, due_date, close_date, total FROM bank_bill")
        .all<BankBillRow>(),
      loadDecided(db),
      loadStatements(db),
      loadMailedBills(db),
      loadMailedContas(db),
      loadPhonePurchases(db),
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
      statements,
      mailedBills,
      mailedContas,
      phone,
    };
  } catch (error) {
    console.error("bank tables unreadable", error);
    return null;
  }
};

/**
 * An ignored card bill leaves Para lançar for good while the bank adds nothing to it, so it is not
 * built again: listed from its key, while its bill is still to come, so it can be brought back.
 */
const ignoredBills = (
  ignored: ReadonlySet<string>,
  built: readonly { readonly key: string }[],
  cards: readonly CardConfig[],
  today: LocalDate,
) => {
  const keys = new Set(built.map((i) => i.key));
  return [...ignored].flatMap((key) => {
    if (keys.has(key)) return [];
    const [at] = ignoredGaps([key]).keys();
    const [name = "", due = ""] = at?.split("|") ?? [];
    const card = cards.find((c) => normalizeName(c.name) === name);
    return card && due >= today ? [{ key, date: due, title: `Fatura ${card.name}` }] : [];
  });
};

/** The bills read from PDFs; none before migration 0011 is applied. */
const loadStatements = async (db: D1Database): Promise<StatementLineRow[]> => {
  try {
    return (
      await db
        .prepare(
          "SELECT account_id, bill_month, card_number, date, description, amount, installment, installments FROM statement_line ORDER BY account_id, bill_month, seq",
        )
        .all<StatementLineRow>()
    ).results;
  } catch (error) {
    console.error("statements unreadable", error);
    return [];
  }
};

/** The bills known from the bank's e-mail; none before migration 0012 is applied. */
const loadMailedBills = async (db: D1Database): Promise<MailedBillRow[]> => {
  try {
    return (
      await db
        .prepare("SELECT card, due_date, total FROM mailed_bill ORDER BY card, due_date")
        .all<MailedBillRow>()
    ).results;
  } catch (error) {
    console.error("mailed bills unreadable", error);
    return [];
  }
};

/** The light and phone bills known from e-mail; none before migration 0013 is applied. */
const loadMailedContas = async (db: D1Database): Promise<MailedContaRow[]> => {
  try {
    return (
      await db
        .prepare(
          "SELECT biller, due_date, total, read_at FROM mailed_conta ORDER BY biller, due_date",
        )
        .all<MailedContaRow>()
    ).results;
  } catch (error) {
    console.error("mailed contas unreadable", error);
    return [];
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
