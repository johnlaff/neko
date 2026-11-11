import { type CardConfig, localDate } from "@neko/engine";
import { describe, expect, it } from "vitest";
import type { UserSettings } from "../src/shared/types.ts";
import { type BankRows, bankInput, loadBank } from "../src/worker/bank.ts";
import { costMicroUsd, type OPUS } from "../src/worker/mia.ts";
import {
  fromRaw,
  openBillDue,
  readStatement,
  saveStatement,
  statementAccount,
} from "../src/worker/statement.ts";
import { sqliteD1 } from "./d1.ts";

// Invented bill: names, numbers and amounts are made up (public repo).
const raw = (over: { pet?: number; total?: number } = {}) => ({
  vencimento: "2026-12-12",
  total: over.total ?? 1061.5,
  cartoes: [
    {
      final: "1111",
      valor: 1000,
      saldo_anterior: 0,
      pagamentos: 0,
      lancamentos: [
        {
          dia: 5,
          mes: 11,
          descricao: "MERCADO  CENTRAL",
          valor: 1159.9,
          parcela: null,
          parcelas: null,
        },
        {
          dia: 17,
          mes: 10,
          descricao: "AJUSTE A CREDITO",
          valor: -159.9,
          parcela: null,
          parcelas: null,
        },
      ],
    },
    {
      final: "2222",
      valor: 61.5,
      saldo_anterior: 0,
      pagamentos: 0,
      lancamentos: [
        {
          dia: 30,
          mes: 10,
          descricao: "PET",
          valor: over.pet ?? 30.75,
          parcela: null,
          parcelas: null,
        },
        { dia: 30, mes: 10, descricao: "PET", valor: 30.75, parcela: null, parcelas: null },
      ],
    },
  ],
});

/** A fake Messages API answering each read with the next scripted bill. */
const api = (reads: unknown[]) => {
  const efforts: string[] = [];
  const spent: number[] = [];
  const deps = {
    fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { output_config: { effort: string } };
      efforts.push(body.output_config.effort);
      const next = reads.shift();
      return Response.json({
        content: [
          { type: "thinking", thinking: "" },
          { type: "text", text: JSON.stringify(next) },
        ],
        stop_reason: "end_turn",
        usage: { input_tokens: 20000, output_tokens: 6000 },
      });
    }) as typeof fetch,
    key: "test-key",
    record: async (model: typeof OPUS, u: Parameters<typeof costMicroUsd>[1]) => {
      spent.push(costMicroUsd(model, u));
    },
  };
  return { deps, efforts, spent };
};

describe("reading the bank's bill PDF", () => {
  it("keeps a read whose sums close, in cents and full dates", async () => {
    const { deps, efforts, spent } = api([raw()]);
    const result = await readStatement(deps, "JVBERi0");
    expect(efforts).toEqual(["medium"]);
    // Opus 5.5 at US$ 4 in, 20 out per million tokens.
    expect(spent).toEqual([200_000]);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.read.cards[0]?.lines[1]).toEqual({
      date: "2026-10-17",
      description: "AJUSTE A CREDITO",
      amount: -15990,
      installment: null,
      installments: null,
    });
    expect(result.read.cards[0]?.lines[0]?.description).toBe("MERCADO CENTRAL");
  });

  it("reads again more carefully when a card's lines miss its total, and gives up saying which", async () => {
    const fixed = await readStatement(api([raw({ pet: 30 }), raw()]).deps, "JVBERi0");
    expect(fixed.kind).toBe("ok");
    const { deps, efforts } = api([raw({ pet: 30 }), raw({ pet: 30 })]);
    expect(await readStatement(deps, "JVBERi0")).toEqual({
      kind: "wrong",
      problems: [{ card: "2222", printed: 6150, read: 6075 }],
    });
    expect(efforts).toEqual(["medium", "high"]);
  });

  it("tells the second read which sums did not close", async () => {
    const asked: string[] = [];
    const { deps } = api([raw({ pet: 30 }), raw()]);
    const seen: typeof fetch = async (url, init) => {
      asked.push(String(init?.body));
      return deps.fetch(url, init);
    };
    await readStatement({ ...deps, fetch: seen }, "JVBERi0");
    expect(asked[0]).not.toContain("não fecharam");
    expect(asked[1]).toContain("cartão final 2222: impresso R$ 61,50, as linhas dão R$ 60,75");
  });

  it("dates an open bill, which prints no due date, by the bill its cards have open", async () => {
    const open = { ...raw(), vencimento: "" };
    const { deps } = api([open]);
    const asked: string[][] = [];
    const result = await readStatement(
      {
        ...deps,
        openDue: (numbers) => {
          asked.push([...numbers]);
          return localDate("2026-12-12");
        },
      },
      "JVBERi0",
    );
    expect(asked).toEqual([["1111", "2222"]]);
    expect(result.kind === "ok" && result.read.due).toBe("2026-12-12");
    // With no card account to tell which bill is open, nothing is read.
    expect(await readStatement(api([open, open]).deps, "JVBERi0")).toEqual({ kind: "unreadable" });
  });

  it("says unreadable when no read comes out", async () => {
    const { deps } = api([{ nada: true }, "x"]);
    expect(await readStatement(deps, "JVBERi0")).toEqual({ kind: "unreadable" });
  });
});

describe("the bill an open statement is", () => {
  it("is the one its card account's holder card has open on the day it is read", () => {
    const map: UserSettings["bankCards"] = [
      { accountId: "a", cardNumber: "2222", card: "Visa Bia" },
      { accountId: "a", cardNumber: null, card: "Visa Ana" },
    ];
    const cards: CardConfig[] = [
      { name: "Visa Ana", closingDay: 29, dueDay: 12, closingEstimated: false },
    ];
    const accounts = [{ id: "a", number: null }];
    // Read after the Oct 29 closing: the open bill is the one due Dec 12.
    expect(openBillDue(["1111", "2222"], accounts, map, cards, localDate("2026-11-05"))).toBe(
      "2026-12-12",
    );
    expect(openBillDue(["9999"], accounts, map, cards, localDate("2026-11-05"))).toBeNull();
  });
});

describe("which card account a bill is", () => {
  const read = fromRaw(raw());
  it("is the one sharing the most card numbers, by Ajustes or its own number", () => {
    const map: UserSettings["bankCards"] = [
      { accountId: "a", cardNumber: "2222", card: "Visa Bia" },
      { accountId: "a", cardNumber: null, card: "Visa Ana" },
    ];
    expect(
      statementAccount(
        read,
        [
          { id: "a", number: "**** 1111" },
          { id: "b", number: "9999" },
        ],
        map,
      ),
    ).toBe("a");
    expect(statementAccount(read, [{ id: "b", number: "9999" }], map)).toBeNull();
    // A tie is not guessed.
    expect(
      statementAccount(
        read,
        [
          { id: "a", number: "1111" },
          { id: "b", number: "2222" },
        ],
        [],
      ),
    ).toBeNull();
  });
});

describe("a kept bill fills in what the feed left out", () => {
  it("names each line by its card number and adds only what the feed lacks", async () => {
    const db = sqliteD1();
    await db.batch([
      db.prepare("INSERT INTO bank_item (item_id, label) VALUES ('i', 'Banco A')"),
      db.prepare(
        "INSERT INTO bank_account (id, item_id, type, name, number, balance) VALUES ('cartao', 'i', 'CREDIT', 'Cartão', '1111', 0)",
      ),
    ]);
    const read = fromRaw(raw());
    await saveStatement(db, "cartao", read, new Date("2026-11-04T12:00:00Z"));
    // Read again: the newer read replaces the older one.
    await saveStatement(db, "cartao", read, new Date("2026-11-04T13:00:00Z"));
    const rows = (await loadBank(db)) as BankRows;
    expect(rows.statements).toHaveLength(4);
    const map: UserSettings["bankCards"] = [
      { accountId: "cartao", cardNumber: null, card: "Visa Ana" },
      { accountId: "cartao", cardNumber: "2222", card: "Visa Bia" },
    ];
    const cards: CardConfig[] = ["Visa Ana", "Visa Bia"].map((name) => ({
      name,
      closingDay: 29,
      dueDay: 12,
      closingEstimated: false,
    }));
    // The feed has the purchase and one of the two equal PET charges.
    const feed: BankRows = {
      ...rows,
      txns: [
        {
          account_id: "cartao",
          date: "2026-11-05",
          amount: 115990,
          type: "DEBIT",
          description: "MERCADO CENTRAL",
          installment: null,
          installments: null,
          bill_id: null,
          card_number: "1111",
        },
        {
          account_id: "cartao",
          date: "2026-10-30",
          amount: 3075,
          type: "DEBIT",
          description: "PET",
          installment: null,
          installments: null,
          bill_id: null,
          card_number: "2222",
        },
      ],
    };
    const added = bankInput(feed, map, cards).lines.filter((l) => l.fromStatement);
    expect(added.map((l) => [l.card, l.description, l.amount, l.billMonth])).toEqual([
      ["Visa Ana", "AJUSTE A CREDITO", -15990, "2026-12"],
      ["Visa Bia", "PET", 3075, "2026-12"],
    ]);
    expect(localDate(added[0]?.date ?? "")).toBe("2026-10-17");
  });
});
