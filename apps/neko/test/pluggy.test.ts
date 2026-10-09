import { localDate } from "@neko/engine";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/worker/env.ts";
import worker from "../src/worker/index.ts";
import {
  civilDate,
  ensureWebhook,
  pluggy,
  sameSecret,
  syncAll,
  syncItem,
  toCents,
} from "../src/worker/pluggy.ts";
import { sqliteD1 } from "./d1.ts";

// Invented bank: ids, names and amounts are made up (public repo).
const ITEM = "11111111-1111-4111-8111-111111111111";
const TODAY = localDate("2026-10-08");

const card = {
  id: "acc-card",
  type: "CREDIT",
  subtype: "CREDIT_CARD",
  name: "Cartão Teste",
  number: "1234",
  balance: 812.5,
  creditData: {
    creditLimit: 5000,
    availableCreditLimit: 4187.5,
    balanceCloseDate: "2026-10-29T00:00:00.000Z",
    balanceDueDate: "2026-11-12T00:00:00.000Z",
  },
};
const txn = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  date: "2026-10-05T00:00:00.000Z",
  description: "LOJA TESTE",
  amount: 100.1,
  type: "DEBIT",
  status: "POSTED",
  providerId: `p-${id}`,
  creditCardMetadata: {
    installmentNumber: 2,
    totalInstallments: 5,
    purchaseDate: "2026-08-20T00:00:00.000Z",
    billForecastDate: "2026-11",
    cardNumber: "9876",
  },
  ...over,
});

/** A fake Pluggy API: routes by path, records calls, pages transactions two at a time. */
const fakeApi = (state: { txns: unknown[]; hooks?: { id: string; url: string }[] }) => {
  const calls: string[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    if (url.pathname === "/auth") return json({ apiKey: "key" });
    if (url.pathname === "/accounts") return json({ results: [card], next: null });
    if (url.pathname === "/bills")
      return json({
        results: [{ id: "bill-1", dueDate: "2026-10-12T00:00:00.000Z", totalAmount: 1500.99 }],
      });
    if (url.pathname === "/v2/transactions") {
      const start = Number(url.searchParams.get("after") ?? 0);
      const page = state.txns.slice(start, start + 2);
      const next = start + 2 < state.txns.length ? `/v2/transactions?after=${start + 2}` : null;
      return json({ results: page, next });
    }
    if (url.pathname === "/webhooks" && init?.method === "POST") {
      state.hooks?.push({ id: "h", url: JSON.parse(String(init.body)).url });
      return json({ id: "h" });
    }
    if (url.pathname === "/webhooks") return json({ results: state.hooks ?? [], next: null });
    return json({}, 404);
  }) as typeof fetch;
  return { f, calls, api: pluggy({ PLUGGY_CLIENT_ID: "id", PLUGGY_CLIENT_SECRET: "s" }, f) };
};

const withItem = async () => {
  const db = sqliteD1();
  await db
    .prepare("INSERT INTO bank_item (item_id, label) VALUES (?, ?)")
    .bind(ITEM, "Banco")
    .run();
  return db;
};

describe("pluggy boundary", () => {
  it("turns reais into cents without float drift", () => {
    expect(toCents(100.1)).toBe(10010);
    expect(toCents(-0.29)).toBe(-29);
    expect(() => toCents(Number.NaN)).toThrow();
  });
  it("reads a bare day as that day and a real instant in São Paulo", () => {
    expect(civilDate("2026-10-05T00:00:00.000Z")).toBe("2026-10-05");
    expect(civilDate("2026-10-06T01:30:00.000Z")).toBe("2026-10-05");
    expect(civilDate("2026-10-06T15:00:00.000Z")).toBe("2026-10-06");
  });
  it("compares the webhook secret whole, and an empty one never matches", () => {
    expect(sameSecret("abc", "abc")).toBe(true);
    expect(sameSecret("abd", "abc")).toBe(false);
    expect(sameSecret("", "")).toBe(false);
  });
});

describe("bank sync", () => {
  it("stores accounts, every page of transactions, parcels and bills in cents", async () => {
    const db = await withItem();
    const { api, calls } = fakeApi({ txns: [txn("t1"), txn("t2"), txn("t3")] });
    await syncItem(db as never, api, ITEM, TODAY);
    const rows = db.sqlite.prepare("SELECT * FROM bank_txn ORDER BY id").all() as Record<
      string,
      unknown
    >[];
    expect(rows.map((r) => r.id)).toEqual(["t1", "t2", "t3"]);
    expect(rows[0]).toMatchObject({
      date: "2026-10-05",
      purchase_date: "2026-08-20",
      amount: 10010,
      installment: 2,
      installments: 5,
      bill_month: "2026-11",
      card_number: "9876",
    });
    expect(db.sqlite.prepare("SELECT * FROM bank_account").get()).toMatchObject({
      balance: 81250,
      credit_limit: 500000,
      due_date: "2026-11-12",
    });
    expect(db.sqlite.prepare("SELECT total FROM bank_bill").get()).toEqual({ total: 150099 });
    expect(calls.filter((c) => c.startsWith("POST /auth"))).toHaveLength(1);
    expect(calls).toContain("GET /v2/transactions?accountId=acc-card&dateFrom=2026-08-29");
    const item = db.sqlite.prepare("SELECT synced_at, error FROM bank_item").get() as {
      synced_at: string | null;
      error: string | null;
    };
    expect(item.synced_at).not.toBeNull();
    expect(item.error).toBeNull();
  });

  it("is idempotent and drops what the bank stopped returning in the window", async () => {
    const db = await withItem();
    await syncItem(db as never, fakeApi({ txns: [txn("t1"), txn("t2")] }).api, ITEM, TODAY);
    // t2 was recreated by the bank under a new id; an old row before the window stays.
    db.sqlite
      .prepare(
        "INSERT INTO bank_txn (id, account_id, date, amount, type, description) VALUES ('old', 'acc-card', '2026-01-02', 5, 'DEBIT', 'x')",
      )
      .run();
    await syncItem(
      db as never,
      fakeApi({ txns: [txn("t1", { amount: 99 }), txn("t2b")] }).api,
      ITEM,
      TODAY,
    );
    const rows = db.sqlite.prepare("SELECT id, amount FROM bank_txn ORDER BY id").all();
    expect(rows).toEqual([
      { id: "old", amount: 5 },
      { id: "t1", amount: 9900 },
      { id: "t2b", amount: 10010 },
    ]);
  });

  it("keeps a purchase abroad in reais, as the bill charges it, not in its own currency", async () => {
    const db = await withItem();
    await syncItem(
      db as never,
      fakeApi({
        txns: [
          txn("usd", { amount: 10, currencyCode: "USD", amountInAccountCurrency: 54.9 }),
          txn("brl", { currencyCode: "BRL", amountInAccountCurrency: null }),
        ],
      }).api,
      ITEM,
      TODAY,
    );
    const rows = db.sqlite.prepare("SELECT id, amount FROM bank_txn ORDER BY id").all();
    expect(rows).toEqual([
      { id: "brl", amount: 10010 },
      { id: "usd", amount: 5490 },
    ]);
  });

  it("keeps the last good read and notes the error when the bank fails", async () => {
    const db = await withItem();
    const broken = pluggy(
      { PLUGGY_CLIENT_ID: "id", PLUGGY_CLIENT_SECRET: "s" },
      (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch,
    );
    expect(await syncAll(db as never, broken, TODAY)).toBe(1);
    expect(db.sqlite.prepare("SELECT error FROM bank_item").get()).toEqual({
      error: "pluggy auth: 500",
    });
  });

  it("rejects a malformed response instead of storing a guess", async () => {
    const db = await withItem();
    const { api } = fakeApi({ txns: [{ id: "t1", amount: "cem" }] });
    await expect(syncItem(db as never, api, ITEM, TODAY)).rejects.toThrow();
    expect(db.sqlite.prepare("SELECT count(*) AS n FROM bank_txn").get()).toEqual({ n: 0 });
  });

  it("registers the webhook once", async () => {
    const state = { txns: [], hooks: [] as { id: string; url: string }[] };
    const { api } = fakeApi(state);
    expect(await ensureWebhook(api, "https://neko.test/api/pluggy/webhook", "s3cret")).toBe(true);
    expect(await ensureWebhook(api, "https://neko.test/api/pluggy/webhook", "s3cret")).toBe(false);
    expect(state.hooks).toHaveLength(1);
  });
});

describe("bank routes", () => {
  const env = (db: unknown) =>
    ({
      DB: db,
      SESSION_SECRET: "test-secret",
      ALLOWED_EMAILS: "dono@example.com",
      PLUGGY_WEBHOOK_SECRET: "s3cret",
    }) as unknown as Env;
  const ctx = {
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
  const hook = (db: unknown, secret?: string) =>
    worker.fetch(
      new Request("https://neko.test/api/pluggy/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(secret ? { "x-neko-hook": secret } : {}),
        },
        body: JSON.stringify({ event: "item/updated", itemId: ITEM }),
      }) as never,
      env(db),
      ctx,
    );

  it("answers the webhook only with the shared secret", async () => {
    const db = await withItem();
    expect((await hook(db)).status).toBe(403);
    expect((await hook(db, "wrong!")).status).toBe(403);
    expect((await hook(db, "s3cret")).status).toBe(200);
  });

  it("lists and changes the linked banks only with a session", async () => {
    const db = await withItem();
    const res = await worker.fetch(
      new Request("https://neko.test/api/banks") as never,
      env(db),
      ctx,
    );
    expect(res.status).toBe(401);
  });
});
