import { describe, expect, it } from "vitest";
import { type BankCardLine, cents, localDate, watchNews } from "../src/index.ts";

const today = localDate("2026-11-20");
const line = (
  date: string,
  description: string,
  amount: number,
  extra: Partial<BankCardLine> = {},
) =>
  ({
    card: "Cartão Azul",
    amount: cents(amount),
    billMonth: "2026-12",
    description,
    installment: null,
    installments: null,
    date: localDate(date),
    ...extra,
  }) satisfies BankCardLine;

describe("watchNews", () => {
  it("says a charge that came twice: same card, store and value, a day apart at most", () => {
    const r = watchNews(
      [
        line("2026-11-18", "PETZ LOJA 12", 89_90),
        line("2026-11-19", "PETZ  LOJA 12", 89_90),
        // The same store and value on another card is another purchase.
        line("2026-11-19", "PETZ LOJA 12", 89_90, { card: "Cartão Verde" }),
      ],
      today,
      [],
    );
    expect(r).toEqual([
      {
        kind: "repetida",
        key: "repetida|petzloja|8990|cartao azul|2026-11-18",
        description: "PETZ  LOJA 12",
        card: "Cartão Azul",
        amount: 89_90,
        dates: ["2026-11-18", "2026-11-19"],
        date: "2026-11-19",
        dispute: false,
      },
    ]);
  });

  it("leaves out small repeats, parcels, fees, charges days apart and someone else's card", () => {
    const r = watchNews(
      [
        // Two rides of the same price on one day happen.
        line("2026-11-19", "DL*99 RIDE", 7_20),
        line("2026-11-19", "DL*99 RIDE", 7_20),
        // Parcels of one plan share a value.
        line("2026-11-18", "LOJA SOFA", 150_00, { installment: 2, installments: 5 }),
        line("2026-11-18", "LOJA SOFA", 150_00, { installment: 2, installments: 5 }),
        line("2026-11-18", "IOF S/ TRANS INTER", 25_00),
        line("2026-11-18", "IOF S/ TRANS INTER", 25_00),
        line("2026-11-12", "MERCADO BOM", 120_00),
        line("2026-11-15", "MERCADO BOM", 120_00),
        line("2026-11-18", "LOJA DOCE", 60_00, { card: "Cartão da Ana" }),
        line("2026-11-18", "LOJA DOCE", 60_00, { card: "Cartão da Ana" }),
      ],
      today,
      ["Cartão da Ana"],
    );
    expect(r).toEqual([]);
  });

  it("says a repeat three times as one, with every day", () => {
    const r = watchNews(
      [
        line("2026-11-17", "STREAMING PLUS", 39_90),
        line("2026-11-17", "STREAMING PLUS", 39_90),
        line("2026-11-18", "STREAMING PLUS", 39_90),
      ],
      today,
      [],
    );
    expect(r.map((n) => [n.kind, n.dates])).toEqual([
      ["repetida", ["2026-11-17", "2026-11-17", "2026-11-18"]],
    ]);
  });

  it("says a refund on a card, and a bank's credit for a dispute, whatever its sign", () => {
    const r = watchNews(
      [
        line("2026-11-16", "PETZ DIGITAL", -75_66),
        // The bank books the dispute's credit as a charge that sends it to the account.
        line("2026-11-17", "CRED EM C/C CONTESTACAO", 159_90),
        // Paying the bill is not a refund, nor the bank giving back a late fee.
        line("2026-11-12", "PAGTO. POR DEB EM C/C", -6297_26),
        line("2026-11-11", "ESTORNO AUTOMATICO MULTA", -5_10),
        line("2026-11-11", "LOJA MODA", -50_00, { card: "Cartão da Ana" }),
      ],
      today,
      ["Cartão da Ana"],
    );
    expect(r).toEqual([
      {
        kind: "estorno",
        key: "estorno|petzdigital|7566|cartao azul|2026-11-16",
        description: "PETZ DIGITAL",
        card: "Cartão Azul",
        amount: 75_66,
        dates: ["2026-11-16"],
        date: "2026-11-16",
        dispute: false,
      },
      {
        kind: "estorno",
        key: "estorno|credemcccontestacao|15990|cartao azul|2026-11-17",
        description: "CRED EM C/C CONTESTACAO",
        card: "Cartão Azul",
        amount: 159_90,
        dates: ["2026-11-17"],
        date: "2026-11-17",
        dispute: true,
      },
    ]);
  });

  it("keeps news for a week only, and never a day still to come", () => {
    const lines = [
      line("2026-11-12", "PETZ DIGITAL", -75_66),
      line("2026-11-10", "LOJA BOA", 45_00),
      line("2026-11-11", "LOJA BOA", 45_00),
      line("2026-11-21", "LOJA FUTURA", -30_00),
    ];
    expect(watchNews(lines, today, []).map((n) => n.description)).toEqual([]);
    expect(watchNews(lines, localDate("2026-11-17"), []).map((n) => n.kind)).toEqual([
      "repetida",
      "estorno",
    ]);
  });

  it("skips lines with no day: there is no telling when they came", () => {
    const { date: _, ...undated } = line("2026-11-18", "PETZ DIGITAL", -75_66);
    expect(watchNews([undated, undated], today, [])).toEqual([]);
  });
});
