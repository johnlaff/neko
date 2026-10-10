import { type CardConfig, localDate } from "@neko/engine";
import { describe, expect, it } from "vitest";
import { UserSettings } from "../src/shared/types.ts";
import { type BankRows, bankInput, bankVersion, bankView, loadBank } from "../src/worker/bank.ts";
import { sqliteD1 } from "./d1.ts";

// Invented bank: ids, names and amounts are made up (public repo).
const txn = (over: Partial<BankRows["txns"][number]>): BankRows["txns"][number] => ({
  account_id: "conta",
  date: "2026-10-05",
  amount: 1000,
  type: "DEBIT",
  description: "LOJA",
  installment: null,
  installments: null,
  bill_id: null,
  card_number: null,
  ...over,
});
const rows: BankRows = {
  items: 1,
  syncedAt: "2026-10-08T09:00:00.000Z",
  accounts: [
    { id: "conta", type: "BANK" },
    { id: "cartao", type: "CREDIT" },
  ],
  txns: [
    txn({ amount: 5000, type: "CREDIT", description: "PIX RECEBIDO" }),
    txn({ amount: -1990, description: "PADARIA" }),
    txn({ account_id: "cartao", amount: 12000, bill_month: "2026-11", card_number: "**** 1111" }),
    txn({ account_id: "cartao", amount: 3000, bill_month: "2026-11", card_number: "2222" }),
    txn({
      account_id: "cartao",
      amount: 500,
      type: "CREDIT",
      bill_id: "b1",
      bill_month: "2026-09",
    }),
    txn({ account_id: "cartao", amount: 700, card_number: "1111" }),
  ],
  bills: [{ id: "b1", account_id: "cartao", due_date: "2026-10-12", total: 98000 }],
};
// Closes on the 29th, due on the 12th: a purchase on Oct 5 lands on the bill due Nov 12.
const cards: CardConfig[] = ["Visa", "Visa Gio"].map((name) => ({
  name,
  closingDay: 29,
  dueDay: 12,
  closingEstimated: false,
}));
const map: UserSettings["bankCards"] = [
  { accountId: "cartao", cardNumber: null, card: "Visa" },
  { accountId: "cartao", cardNumber: "2222", card: "Visa Gio" },
];

describe("bank rows to the engine", () => {
  it("signs by type, names each card line by its number, then by its account, and dates it by the card's cycle", () => {
    const { lines, movements } = bankInput(rows, map, cards);
    expect(movements.map((m) => [m.description, m.amount])).toEqual([
      ["PIX RECEBIDO", 5000],
      ["PADARIA", -1990],
    ]);
    expect(lines.map((l) => [l.card, l.amount, l.billMonth])).toEqual([
      ["Visa", 12000, "2026-11"],
      ["Visa Gio", 3000, "2026-11"],
      ["Visa", -500, "2026-10"],
      ["Visa", 700, "2026-11"],
    ]);
  });

  it("gives each listed bill's total with the cards of its account", () => {
    expect(bankInput(rows, map, cards).closed).toEqual([
      { cards: ["Visa", "Visa Gio"], billMonth: "2026-10", total: 98000 },
    ]);
    expect(bankInput(rows, map.slice(0, 1), cards).closed).toEqual([
      { cards: ["Visa"], billMonth: "2026-10", total: 98000 },
    ]);
  });

  it("never puts a line the bank left off a listed bill on that bill", () => {
    // Closes on the 29th by the card's cycle, but the bank already closed the bill due Oct 12
    // without it: a purchase made on the closing day goes to the next one.
    const late = txn({ account_id: "cartao", date: "2026-09-29", amount: 900 });
    const { lines } = bankInput({ ...rows, txns: [...rows.txns, late] }, map, cards);
    expect(lines.at(-1)).toMatchObject({ amount: 900, billMonth: "2026-11" });
  });

  it("drops card lines with no sheet name or no bill to land on", () => {
    expect(bankInput(rows, [], cards).lines).toEqual([]);
    expect(bankInput({ ...rows, txns: rows.txns.slice(2, 4) }, map, []).lines).toEqual([]);
  });
});

describe("bank tables", () => {
  it("are no bank at all until one is linked, and tell syncs apart", async () => {
    const db = sqliteD1();
    expect(await loadBank(db as never)).toBeNull();
    expect(bankVersion(null)).toBe("none");
    db.sqlite.exec(
      "INSERT INTO bank_item (item_id, label, synced_at) VALUES ('i', 'Banco', '2026-10-08T09:00:00Z')",
    );
    const read = await loadBank(db as never);
    expect(read).toMatchObject({ items: 1, syncedAt: "2026-10-08T09:00:00Z", txns: [] });
    expect(bankVersion(read)).not.toBe("none");
  });

  it("missing tables leave the sheet's screens alone", async () => {
    const db = sqliteD1();
    db.sqlite.exec(
      "DROP TABLE bank_txn; DROP TABLE bank_bill; DROP TABLE bank_account; DROP TABLE bank_item",
    );
    expect(await loadBank(db as never)).toBeNull();
  });
});

describe("settings", () => {
  it("keeps bank cards with a four-digit number or none", () => {
    expect(UserSettings.parse({}).bankCards).toEqual([]);
    expect(() =>
      UserSettings.parse({ bankCards: [{ accountId: "a", cardNumber: "12", card: "X" }] }),
    ).toThrow();
  });
});

describe("Para lançar from the bank rows", () => {
  it("leaves a pending movement waiting and words each item in the sheet's terms", async () => {
    const { ledger } = await import("../../../packages/engine/test/builders.ts");
    const days = ledger("2026-10-01", 92, 100000);
    const settings = UserSettings.parse({ bankCards: map });
    const view = bankView(
      {
        ...rows,
        itemRows: [{ item_id: "i", label: "Banco A", synced_at: "2026-10-08T09:00:00.000Z" }],
        accounts: [
          { id: "conta", type: "BANK", item_id: "i", balance: 103010 },
          { id: "cartao", type: "CREDIT", item_id: "i" },
        ],
        txns: [
          txn({ id: "p1", amount: 5000, type: "CREDIT", description: "PIX RECEBIDO" }),
          txn({ id: "p2", amount: -1990, description: "PADARIA" }),
          txn({ id: "p3", amount: -700, description: "MERCADO", status: "PENDING" }),
        ],
      },
      days,
      cards,
      settings,
      localDate("2026-10-08"),
    );
    expect(view?.queue?.map((i) => [i.key, i.kind, i.title, i.options[0]?.lines])).toEqual([
      [
        "mov:p1",
        "entrada",
        "PIX RECEBIDO",
        [
          {
            label: "05/10 · Entrada",
            change: "new",
            before: null,
            after: 5000,
            diff: null,
            cell: null,
          },
        ],
      ],
      [
        "mov:p2",
        "diario",
        "PADARIA",
        [
          {
            label: "05/10 · Diário",
            change: "new",
            before: null,
            after: 1990,
            diff: null,
            cell: null,
          },
        ],
      ],
    ]);
    expect(view?.queue?.[0]?.note).toBe("Entrou dinheiro que a planilha ainda não tem.");
    expect(view?.queue?.[1]?.bank).toEqual([
      { date: "2026-10-05", amount: -1990, description: "PADARIA" },
    ]);
    expect(view?.saldo).toEqual({
      date: "2026-10-07",
      sheet: 100000,
      bank: 103010,
      diff: 3010,
      stale: [],
    });
  });
});
