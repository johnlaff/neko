import type { CardConfig } from "@neko/engine";
import { describe, expect, it } from "vitest";
import { UserSettings } from "../src/shared/types.ts";
import { type BankRows, bankInput, bankVersion, loadBank } from "../src/worker/bank.ts";
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

  it("gives a closed bill's total only when its account is one card in the sheet", () => {
    expect(bankInput(rows, map, cards).closed).toEqual([]);
    expect(bankInput(rows, map.slice(0, 1), cards).closed).toEqual([
      { card: "Visa", billMonth: "2026-10", total: 98000 },
    ]);
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
