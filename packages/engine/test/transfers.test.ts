import { describe, expect, it } from "vitest";
import {
  type BankMovement,
  billPayers,
  cents,
  localDate,
  type PayerAccount,
  transfersDue,
} from "../src/index.ts";
import { cell, item, ledger } from "./builders.ts";

const today = localDate("2026-11-10");
const m = (date: string, amount: number, description: string, account: string): BankMovement => ({
  date: localDate(date),
  amount: cents(amount),
  description,
  account,
});
// Invented banks: Azul keeps a checking account and the card it pays by itself; Verde is where
// the salary lands and bills are paid by hand.
const azul: PayerAccount = {
  id: "azul-cc",
  label: "Banco Azul",
  bank: "azul",
  balance: cents(500000),
  readOn: today,
};
const verde: PayerAccount = {
  id: "verde-cc",
  label: "Banco Verde",
  bank: "verde",
  balance: cents(900000),
  readOn: today,
};
const cards = [
  { bank: "azul", card: "Azul Titular" },
  { bank: "azul", card: "Azul Adicional" },
  { bank: "verde", card: "Verde" },
];
const debitedLastMonth = m("2026-10-14", -480000, "GASTOS CARTAO DE CREDITO - DOCTO: 1", "azul-cc");

describe("which account pays a card bill by itself", () => {
  it("is the account the bank debited a bill from, for the cards of the same bank", () => {
    expect(billPayers([azul, verde], cards, [debitedLastMonth], today)).toEqual([
      {
        account: "azul-cc",
        label: "Banco Azul",
        balance: 500000,
        cards: ["Azul Titular", "Azul Adicional"],
        lastPaid: "2026-10-14",
      },
    ]);
  });

  it("is none for an account that pays by Pix, or a payment too old to say", () => {
    const pix = m("2026-10-10", -100000, "PIX ENVIADO VERDE PAGAMENTOS", "verde-cc");
    const old = m("2026-07-01", -480000, "PAGAMENTO DE FATURA", "azul-cc");
    expect(billPayers([azul, verde], cards, [pix, old], today)).toEqual([]);
  });

  it("is none when the bank's balance was not read since yesterday", () => {
    const stale = { ...azul, readOn: localDate("2026-11-07") };
    expect(billPayers([stale], cards, [debitedLastMonth], today)).toEqual([]);
  });

  it("is none when no linked card belongs to the account's bank", () => {
    expect(billPayers([azul], cards.slice(2), [debitedLastMonth], today)).toEqual([]);
  });
});

describe("what to move before the bank debits a bill", () => {
  const payer = billPayers([azul], cards, [debitedLastMonth], today);
  // The holder's and the additional card's lines make one bill, debited in full.
  const days = ledger("2026-11-01", 30, 0, {
    "2026-11-12": {
      saida: cell(620000, [item(450000, "Azul Titular"), item(170000, "Azul Adicional")]),
    },
    "2026-11-20": { saida: cell(30000, [item(30000, "Verde")]) },
  });

  it("is the whole bill less the account's balance, from two days before the due day", () => {
    expect(transfersDue(days, payer, today)).toEqual([
      {
        to: "Banco Azul",
        amount: 120000,
        balance: 500000,
        bills: [
          { card: "Azul Titular", due: "2026-11-12", amount: 450000 },
          { card: "Azul Adicional", due: "2026-11-12", amount: 170000 },
        ],
      },
    ]);
    expect(transfersDue(days, payer, localDate("2026-11-12"))).toHaveLength(1);
  });

  it("is nothing three days ahead, after the due day, or when the balance covers it", () => {
    expect(transfersDue(days, payer, localDate("2026-11-09"))).toEqual([]);
    expect(transfersDue(days, payer, localDate("2026-11-13"))).toEqual([]);
    const rich = billPayers(
      [{ ...azul, balance: cents(620000) }],
      cards,
      [debitedLastMonth],
      today,
    );
    expect(transfersDue(days, rich, today)).toEqual([]);
  });

  it("is nothing once the bank already took this bill, early or pending", () => {
    const early = m("2026-11-09", -620000, "PAGAMENTO DE FATURA", "azul-cc");
    expect(transfersDue(days, billPayers([azul], cards, [early], today), today)).toEqual([]);
  });

  it("leaves out a card paid from another bank", () => {
    const later = localDate("2026-11-18");
    expect(transfersDue(days, payer, later)).toEqual([]);
  });
});
