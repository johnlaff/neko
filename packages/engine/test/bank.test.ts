import { describe, expect, it } from "vitest";
import {
  type BankCardLine,
  type BankMovement,
  billChecks,
  type CardConfig,
  cents,
  localDate,
  unmatchedMovements,
} from "../src/index.ts";
import { cell, item, ledger } from "./builders.ts";

const visa: CardConfig = { name: "Visa", closingDay: 3, dueDay: 10, closingEstimated: false };
const line = (
  amount: number,
  billMonth: string,
  over: Partial<BankCardLine> = {},
): BankCardLine => ({
  card: "Visa",
  amount: cents(amount),
  billMonth,
  description: "LOJA",
  installment: null,
  installments: null,
  ...over,
});

describe("bills: what the bank already knows against what the sheet expects", () => {
  // Sheet: Visa 300,00 on Nov 10 and nothing yet on Dec 10.
  const days = ledger("2026-10-01", 92, 0, {
    "2026-11-10": { saida: cell(30000, [item(30000, "Visa")]) },
  });
  const today = localDate("2026-10-20");

  it("sums each future bill and its parcels, and the gap to the sheet", () => {
    const checks = billChecks(
      days,
      [visa],
      [
        line(12000, "2026-11", { installment: 2, installments: 5 }),
        line(5050, "2026-11"),
        line(12000, "2026-12", { installment: 3, installments: 5 }),
      ],
      today,
    );
    expect(checks).toMatchObject([
      { card: "Visa", due: "2026-11-10", bank: 17050, parcels: 12000, sheet: 30000, gap: -12950 },
      { card: "Visa", due: "2026-12-10", bank: 12000, parcels: 12000, sheet: 0, gap: 12000 },
    ]);
    // An open bill below the sheet is only still growing.
    expect(checks[0]?.disagrees).toBe(false);
  });

  it("keeps each bill's lines, purchases first, and flags only a real disagreement", () => {
    const checks = billChecks(
      days,
      [visa],
      [
        line(12000, "2026-11", { installment: 2, installments: 5, date: localDate("2026-10-04") }),
        line(5050, "2026-11", { description: "MERCADO", date: localDate("2026-10-08") }),
        line(1000, "2026-11", { description: "PADARIA", date: localDate("2026-10-12") }),
        line(31000, "2026-12"),
      ],
      today,
      [{ cards: ["Visa"], billMonth: "2026-11", total: cents(18050) }],
    );
    expect(checks[0]?.lines.map((l) => l.description)).toEqual(["PADARIA", "MERCADO", "LOJA"]);
    // Closed below the sheet, and open above it: both mean the sheet should change.
    expect(checks.map((c) => [c.due, c.closed, c.disagrees])).toEqual([
      ["2026-11-10", true, true],
      ["2026-12-10", false, true],
    ]);
  });

  it("carries the parcels still to come onto the next bills, once per purchase", () => {
    const checks = billChecks(
      days,
      [visa],
      [
        line(12000, "2026-11", { description: "LOJA PARC 02/04", installment: 2, installments: 4 }),
        line(12000, "2026-12", { description: "LOJA PARC 03/04", installment: 3, installments: 4 }),
        line(5000, "2026-11", { description: "SAPATO", installment: 1, installments: 2 }),
      ],
      today,
    );
    expect(checks.map((c) => [c.due, c.parcels])).toEqual([
      ["2026-11-10", 17000],
      ["2026-12-10", 17000],
    ]);
  });

  it("counts a closed bill by its total, even when the bank listed only part of it", () => {
    const checks = billChecks(
      days,
      [visa],
      [line(25000, "2026-11"), line(12000, "2026-12", { installment: 1, installments: 2 })],
      today,
      [{ cards: ["Visa"], billMonth: "2026-11", total: cents(30000) }],
    );
    expect(checks.map((c) => [c.due, c.bank, c.gap])).toEqual([
      ["2026-11-10", 30000, 0],
      ["2026-12-10", 12000, 12000],
    ]);
  });

  describe("a closed bill shared by holder and additional cards", () => {
    const gio: CardConfig = { ...visa, name: "Visa Gio" };
    // Sheet: Visa 300,00 and Visa Gio 100,00 on Nov 10; the bank's bill is 400,00.
    const shared = ledger("2026-10-01", 92, 0, {
      "2026-11-10": { saida: cell(40000, [item(30000, "Visa"), item(10000, "Visa Gio")]) },
    });
    const closed = [{ cards: ["Visa", "Visa Gio"], billMonth: "2026-11", total: cents(40000) }];
    const gaps = (lines: BankCardLine[], total = 40000) =>
      billChecks(shared, [visa, gio], lines, today, [{ ...closed[0]!, total: cents(total) }]).map(
        (c) => [c.card, c.gap],
      );

    it("keeps the sheet's split when its sum is the bill", () => {
      // The bank left a line out and put a later purchase on Gio: the sheet already adds up.
      expect(gaps([line(29000, "2026-11"), line(12000, "2026-11", { card: "Visa Gio" })])).toEqual([
        ["Visa", 0],
        ["Visa Gio", 0],
      ]);
    });

    it("follows the bank's lines when theirs add up to the bill", () => {
      expect(
        gaps([line(32000, "2026-11"), line(10000, "2026-11", { card: "Visa Gio" })], 42000),
      ).toEqual([
        ["Visa", 2000],
        ["Visa Gio", 0],
      ]);
    });

    it("says nothing when neither adds up, rather than guess each card's share", () => {
      expect(
        gaps([line(31000, "2026-11"), line(10000, "2026-11", { card: "Visa Gio" })], 42000),
      ).toEqual([]);
    });
  });

  it("keeps apart two equal purchases a month apart", () => {
    const checks = billChecks(
      days,
      [visa],
      [
        line(10000, "2026-11", { installment: 1, installments: 3 }),
        line(10000, "2026-11", { installment: 2, installments: 3 }),
      ],
      today,
    );
    expect(checks.map((c) => [c.due, c.parcels])).toEqual([
      ["2026-11-10", 20000],
      ["2026-12-10", 20000],
    ]);
  });

  it("adds no parcels ahead when the bank put the whole plan on one bill", () => {
    const checks = billChecks(
      days,
      [visa],
      [1, 2, 3, 4].map((k) =>
        line(k === 1 ? 2397 : 2396, "2026-11", { installment: k, installments: 4 }),
      ),
      today,
    );
    expect(checks.map((c) => [c.due, c.parcels])).toEqual([["2026-11-10", 9585]]);
  });

  it("knows a parcel the bank lists ahead with a shorter text or a rounded value", () => {
    const checks = billChecks(
      days,
      [visa],
      [
        line(1820, "2026-11", {
          description: "MERCADOLIVRE*MERCADOLI",
          installment: 3,
          installments: 4,
        }),
        line(1820, "2026-12", {
          description: "MERCADOLIVRE*MERC",
          installment: 4,
          installments: 4,
        }),
        line(3198, "2026-11", { description: "LOJA X", installment: 1, installments: 2 }),
        line(3196, "2026-12", { description: "LOJA X", installment: 2, installments: 2 }),
      ],
      today,
    );
    expect(checks.map((c) => [c.due, c.bank])).toEqual([
      ["2026-11-10", 5018],
      ["2026-12-10", 5016],
    ]);
  });

  it("leaves out bills the sheet does not reach yet", () => {
    const checks = billChecks(
      days,
      [visa],
      [line(12000, "2026-12", { installment: 1, installments: 3 })],
      today,
    );
    // Dec is in the sheet; Jan and Feb are past the ledger's last day.
    expect(checks.map((c) => c.due)).toEqual(["2026-12-10"]);
  });

  it("leaves out bills already due and cards the sheet does not know", () => {
    const checks = billChecks(
      days,
      [visa],
      [line(1000, "2026-10"), line(1000, "2026-11", { card: "Outro" })],
      today,
    );
    expect(checks).toEqual([]);
  });

  it("a refund lowers the bill; a payment of the previous bill is not part of it", () => {
    const checks = billChecks(
      days,
      [visa],
      [
        line(10000, "2026-11"),
        line(-2500, "2026-11", { description: "ESTORNO LOJA" }),
        line(-30000, "2026-11", { description: "PAGAMENTO RECEBIDO" }),
      ],
      today,
    );
    expect(checks[0]).toMatchObject({ bank: 7500 });
  });
});

describe("account movements the sheet does not have", () => {
  const days = ledger("2026-10-01", 20, 0, {
    "2026-10-03": { entrada: cell(601273, [item(601273, "Salário", null)]) },
    "2026-10-05": { saida: cell(148424, [item(148424, "Aluguel", "contas")]) },
    "2026-10-07": { saida: cell(4990) },
  });
  const today = localDate("2026-10-15");
  const mov = (date: string, amount: number, description = "x", account = "a"): BankMovement => ({
    date: localDate(date),
    amount: cents(amount),
    description,
    account,
  });

  it("matches by exact amount within 7 days, each sheet line used once", () => {
    const missing = unmatchedMovements(
      days,
      [
        mov("2026-10-02", 601273, "SALARIO"),
        mov("2026-10-09", -148424, "PIX ALUGUEL"),
        mov("2026-10-07", -4990, "LOJA"),
        mov("2026-10-08", -4990, "LOJA DE NOVO"),
        mov("2026-10-14", -1000, "PADARIA"),
      ],
      today,
    );
    expect(missing.map((m) => m.description)).toEqual(["LOJA DE NOVO", "PADARIA"]);
  });

  it("does not look past 7 days, nor at movements after today", () => {
    const missing = unmatchedMovements(
      days,
      [mov("2026-10-13", -148424, "LONGE DEMAIS"), mov("2026-10-16", -500, "AMANHÃ")],
      today,
    );
    expect(missing.map((m) => m.description)).toEqual(["LONGE DEMAIS"]);
  });

  it("an entrada never pays for a saída of the same amount", () => {
    const missing = unmatchedMovements(days, [mov("2026-10-05", 148424, "DEVOLUÇÃO")], today);
    expect(missing).toHaveLength(1);
  });

  it("leaves out money moved between the owner's own accounts", () => {
    const missing = unmatchedMovements(
      days,
      [
        mov("2026-10-04", -1392874, "PIX ENVIADO", "banco"),
        mov("2026-10-04", 1392874, "PIX RECEBIDO", "carteira"),
        mov("2026-10-05", -2000, "PIX ENVIADO", "banco"),
        mov("2026-10-05", 2000, "DEVOLUÇÃO", "banco"),
        mov("2026-10-06", -3000, "TRANSF POUP PARA C/C", "banco"),
        mov("2026-10-06", 3000, "TRANSF POUP PARA C/C", "banco"),
      ],
      today,
    );
    expect(missing.map((m) => m.description)).toEqual(["PIX ENVIADO", "DEVOLUÇÃO"]);
  });

  it("leaves out the payment of a card bill, which the bills already check", () => {
    const missing = unmatchedMovements(
      days,
      [
        mov("2026-10-12", -596851, "GASTOS CARTAO DE CREDITO - DOCTO: 1"),
        mov("2026-10-02", -19689, "Pagamento efetuado - Pagamento Fatura"),
      ],
      today,
    );
    expect(missing).toEqual([]);
  });

  it("takes one movement for two lines of the same sheet day", () => {
    const two = ledger("2026-10-01", 20, 0, {
      "2026-10-07": {
        entrada: cell(275651, [item(100651, "Carro"), item(11700, "Remédio"), item(163300, "Gio")]),
      },
    });
    expect(unmatchedMovements(two, [mov("2026-10-07", 112351, "PIX RECEBIDO")], today)).toEqual([]);
  });
});
