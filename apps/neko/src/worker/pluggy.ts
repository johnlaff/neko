import { addDays, type LocalDate, localDate, todayIn } from "@neko/engine";
import { z } from "zod";
import type { Env } from "./env.ts";

/**
 * Open Finance through Meu Pluggy, read-only (specs/003-open-finance). Every response is parsed
 * at this boundary; a webhook only says "look at item X" and is never trusted for data.
 */

const API = "https://api.pluggy.ai";
/**
 * Days re-read on each sync: a closed bill not yet due started up to about 45 days ago, so this
 * covers all of it, plus late postings and deletions.
 */
export const SYNC_DAYS = 75;
export const HOOK_HEADER = "x-neko-hook";

const Auth = z.object({ apiKey: z.string().min(1) });

const CreditData = z
  .object({
    creditLimit: z.number().nullish(),
    availableCreditLimit: z.number().nullish(),
    balanceCloseDate: z.string().nullish(),
    balanceDueDate: z.string().nullish(),
  })
  .nullish();

const Account = z.object({
  id: z.string().min(1),
  type: z.string(),
  subtype: z.string().nullish(),
  name: z.string(),
  number: z.string().nullish(),
  balance: z.number(),
  creditData: CreditData,
});

const Transaction = z.object({
  id: z.string().min(1),
  date: z.string(),
  description: z.string(),
  amount: z.number(),
  currencyCode: z.string().nullish(),
  amountInAccountCurrency: z.number().nullish(),
  type: z.string(),
  status: z.string().nullish(),
  providerId: z.string().nullish(),
  creditCardMetadata: z
    .object({
      installmentNumber: z.number().int().nullish(),
      totalInstallments: z.number().int().nullish(),
      purchaseDate: z.string().nullish(),
      billId: z.string().nullish(),
      cardNumber: z.string().nullish(),
      billForecastDate: z.string().nullish(),
    })
    .nullish(),
});

const Bill = z.object({
  id: z.string().min(1),
  dueDate: z.string(),
  billClosingDate: z.string().nullish(),
  totalAmount: z.number(),
});

const Page = <T extends z.ZodType>(item: T) =>
  z.object({ results: z.array(item), next: z.string().nullish() });

const Webhook = z.object({ id: z.string(), url: z.string() });

export const WebhookEvent = z.object({ event: z.string(), itemId: z.string().optional() });

export type Fetch = typeof fetch;

/** Reais with two decimals to integer cents, refusing anything that is not money. */
/**
 * A purchase abroad comes in its own currency (USD 10,00); the bill charges it in reais, converted,
 * and that is what the sheet holds.
 */
const inReais = (t: z.infer<typeof Transaction>): number =>
  t.currencyCode && t.currencyCode !== "BRL" && t.amountInAccountCurrency != null
    ? t.amountInAccountCurrency
    : t.amount;

export const toCents = (reais: number): number => {
  const c = Math.round(reais * 100);
  if (!Number.isSafeInteger(c)) throw new RangeError(`not money: ${reais}`);
  return c;
};

/**
 * Pluggy sends instants in UTC. A bare day arrives as midnight UTC and is that civil day; a real
 * instant is read in São Paulo, so a 22:30 purchase does not move to the next day.
 */
export const civilDate = (iso: string): LocalDate =>
  /T00:00:00(\.0+)?Z$/.test(iso) || /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? localDate(iso.slice(0, 10))
    : todayIn(new Date(iso));

const BillMonth = /^\d{4}-\d{2}$/;

export const pluggy = (env: Pick<Env, "PLUGGY_CLIENT_ID" | "PLUGGY_CLIENT_SECRET">, f: Fetch) => {
  let key: string | null = null;
  const auth = async () => {
    if (key) return key;
    const r = await f(`${API}/auth`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientId: env.PLUGGY_CLIENT_ID,
        clientSecret: env.PLUGGY_CLIENT_SECRET,
      }),
    });
    if (!r.ok) throw new Error(`pluggy auth: ${r.status}`);
    key = Auth.parse(await r.json()).apiKey;
    return key;
  };
  const call = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const r = await f(`${API}${path}`, {
      method,
      headers: {
        "X-API-KEY": await auth(),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : null,
    });
    if (!r.ok) throw new Error(`pluggy ${method} ${path.split("?")[0]}: ${r.status}`);
    return r.json();
  };
  /** Follows `next` until the last page; Pluggy's cursor links are relative to the API. */
  const all = async <T extends z.ZodType>(item: T, first: string): Promise<z.infer<T>[]> => {
    const out: z.infer<T>[] = [];
    let path: string | null = first;
    for (let guard = 0; path && guard < 100; guard++) {
      const page = Page(item).parse(await call("GET", path));
      out.push(...page.results);
      path = page.next ? new URL(page.next, API).pathname + new URL(page.next, API).search : null;
    }
    return out;
  };
  return {
    accounts: (itemId: string) => all(Account, `/accounts?itemId=${encodeURIComponent(itemId)}`),
    transactions: (accountId: string, from: LocalDate) =>
      all(
        Transaction,
        `/v2/transactions?accountId=${encodeURIComponent(accountId)}&dateFrom=${from}`,
      ),
    bills: (accountId: string) => all(Bill, `/bills?accountId=${encodeURIComponent(accountId)}`),
    webhooks: () => all(Webhook, "/webhooks"),
    createWebhook: (url: string, secret: string) =>
      call("POST", "/webhooks", { event: "all", url, headers: { [HOOK_HEADER]: secret } }),
  };
};

export type Pluggy = ReturnType<typeof pluggy>;

export const configured = (env: Env): boolean =>
  Boolean(env.PLUGGY_CLIENT_ID && env.PLUGGY_CLIENT_SECRET);

/**
 * Re-reads one bank: its accounts, the last SYNC_DAYS of transactions (and the future parcels the
 * card already knows), and the card bills. Idempotent: upserts by Pluggy's id and drops what the
 * bank no longer returns in the window, since Pluggy may delete a transaction and recreate it.
 */
export const syncItem = async (
  db: D1Database,
  api: Pluggy,
  itemId: string,
  today: LocalDate,
): Promise<void> => {
  const from = addDays(today, -SYNC_DAYS);
  try {
    const accounts = await api.accounts(itemId);
    for (const a of accounts) {
      const isCard = a.type === "CREDIT";
      const [txns, bills] = await Promise.all([
        api.transactions(a.id, from),
        isCard ? api.bills(a.id) : Promise.resolve([]),
      ]);
      const credit = a.creditData;
      const stmts: D1PreparedStatement[] = [
        db
          .prepare(
            `INSERT INTO bank_account (id, item_id, type, subtype, name, number, balance, credit_limit, available_limit, close_date, due_date)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET type = excluded.type, subtype = excluded.subtype, name = excluded.name,
               number = excluded.number, balance = excluded.balance, credit_limit = excluded.credit_limit,
               available_limit = excluded.available_limit, close_date = excluded.close_date,
               due_date = excluded.due_date, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
          )
          .bind(
            a.id,
            itemId,
            a.type,
            a.subtype ?? null,
            a.name,
            a.number ?? null,
            toCents(a.balance),
            credit?.creditLimit == null ? null : toCents(credit.creditLimit),
            credit?.availableCreditLimit == null ? null : toCents(credit.availableCreditLimit),
            credit?.balanceCloseDate ? civilDate(credit.balanceCloseDate) : null,
            credit?.balanceDueDate ? civilDate(credit.balanceDueDate) : null,
          ),
      ];
      const ids = txns.map((t) => t.id);
      stmts.push(
        db
          .prepare(
            `DELETE FROM bank_txn WHERE account_id = ? AND date >= ? AND id NOT IN (SELECT value FROM json_each(?))`,
          )
          .bind(a.id, from, JSON.stringify(ids)),
      );
      for (const t of txns) {
        const card = t.creditCardMetadata;
        // Kept as Pluggy sends it; bank.ts dates each line by the card's cycle instead.
        const month = card?.billForecastDate?.slice(0, 7);
        stmts.push(
          db
            .prepare(
              `INSERT INTO bank_txn (id, account_id, date, purchase_date, amount, type, status, description, provider_id, installment, installments, bill_id, bill_month, card_number)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET date = excluded.date, purchase_date = excluded.purchase_date,
                 amount = excluded.amount, type = excluded.type, status = excluded.status,
                 description = excluded.description, provider_id = excluded.provider_id,
                 installment = excluded.installment, installments = excluded.installments,
                 bill_id = excluded.bill_id, bill_month = excluded.bill_month,
                 card_number = excluded.card_number, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
            )
            .bind(
              t.id,
              a.id,
              civilDate(t.date),
              card?.purchaseDate ? civilDate(card.purchaseDate) : null,
              toCents(inReais(t)),
              t.type,
              t.status ?? null,
              t.description,
              t.providerId ?? null,
              card?.installmentNumber ?? null,
              card?.totalInstallments ?? null,
              card?.billId ?? null,
              month && BillMonth.test(month) ? month : null,
              card?.cardNumber ?? null,
            ),
        );
      }
      for (const b of bills)
        stmts.push(
          db
            .prepare(
              `INSERT INTO bank_bill (id, account_id, due_date, close_date, total) VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET due_date = excluded.due_date, close_date = excluded.close_date,
                 total = excluded.total, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
            )
            .bind(
              b.id,
              a.id,
              civilDate(b.dueDate),
              b.billClosingDate ? civilDate(b.billClosingDate) : null,
              toCents(b.totalAmount),
            ),
        );
      await db.batch(stmts);
    }
    await db
      .prepare(
        "UPDATE bank_item SET synced_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), error = NULL WHERE item_id = ?",
      )
      .bind(itemId)
      .run();
  } catch (error) {
    // The bank's state stays as last read; Ajustes shows that this one is behind and why.
    await db
      .prepare("UPDATE bank_item SET error = ? WHERE item_id = ?")
      .bind(String(error instanceof Error ? error.message : error).slice(0, 200), itemId)
      .run();
    throw error;
  }
};

export const itemIds = async (db: D1Database): Promise<string[]> =>
  (
    await db.prepare("SELECT item_id FROM bank_item ORDER BY item_id").all<{ item_id: string }>()
  ).results.map((r) => r.item_id);

/** Every linked bank, one after the other; one failing bank does not stop the rest. */
export const syncAll = async (db: D1Database, api: Pluggy, today: LocalDate): Promise<number> => {
  let failed = 0;
  for (const id of await itemIds(db))
    await syncItem(db, api, id, today).catch((error) => {
      failed++;
      console.error("bank sync failed", id, error);
    });
  return failed;
};

/** Registers this site's webhook once; later runs find it and do nothing. */
export const ensureWebhook = async (api: Pluggy, url: string, secret: string): Promise<boolean> => {
  if ((await api.webhooks()).some((w) => w.url === url)) return false;
  await api.createWebhook(url, secret);
  return true;
};

/** Constant-time comparison, so the webhook secret cannot be guessed byte by byte. */
export const sameSecret = (a: string, b: string): boolean => {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length || x.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
};
