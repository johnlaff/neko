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
    expect(checks).toEqual([
      { card: "Visa", due: "2026-11-10", bank: 17050, parcels: 12000, sheet: 30000, gap: -12950 },
      { card: "Visa", due: "2026-12-10", bank: 12000, parcels: 12000, sheet: 0, gap: 12000 },
    ]);
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
  const mov = (date: string, amount: number, description = "x"): BankMovement => ({
    date: localDate(date),
    amount: cents(amount),
    description,
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
});
