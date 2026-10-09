import { describe, expect, it } from "vitest";
import {
  type BankCardLine,
  type BankMovement,
  buildQueue,
  type CardConfig,
  cents,
  isFreeDiario,
  isOnlyForecast,
  localDate,
  matchMovements,
  monthsSince,
  project,
  type QueueInput,
  realDiario,
  type SpendInput,
  suggestDaily,
  variableSpend,
} from "../src/index.ts";
import { cell, item, ledger } from "./builders.ts";

const d = localDate;
const visa: CardConfig = { name: "Visa", closingDay: 3, dueDay: 10, closingEstimated: false };
const today = d("2026-10-20");
const forecast = (amount: number) => cell(amount, [item(amount, "Previsto", null)]);

const mov = (date: string, amount: number, description: string, account = "cc"): BankMovement => ({
  date: d(date),
  amount: cents(amount),
  description,
  account,
  id: `${date}-${amount}`,
});
const buy = (date: string, amount: number, over: Partial<BankCardLine> = {}): BankCardLine => ({
  card: "Visa",
  amount: cents(amount),
  billMonth: "2026-11",
  description: "LOJA",
  installment: null,
  installments: null,
  date: d(date),
  ...over,
});

const spendInput = (over: Partial<SpendInput> = {}): SpendInput => ({
  ledger: ledger("2026-07-01", 184, 0),
  today,
  movements: [],
  lines: [],
  othersCards: ["Gio"],
  savingsAccounts: new Set(),
  savedOrigins: new Set(),
  ...over,
});

describe("Diário cells", () => {
  it("tells a free Diário, Neko's forecast, and what was really spent", () => {
    expect(isFreeDiario(cell())).toBe(true);
    expect(isFreeDiario(forecast(4500))).toBe(false);
    expect(isOnlyForecast(forecast(4500))).toBe(true);
    expect(
      isOnlyForecast(cell(5700, [item(4500, "Previsto", null), item(1200, "Café", null)])),
    ).toBe(false);
    expect(realDiario(cell(5700, [item(4500, "Previsto", null), item(1200, "Café", null)]))).toBe(
      1200,
    );
  });

  it("never matches a bank movement to a forecast", () => {
    const days = ledger("2026-10-01", 31, 0, { "2026-10-15": { diario: forecast(4500) } });
    const m = matchMovements(days, [mov("2026-10-15", -4500, "PIX PADARIA")], today);
    expect(m.unmatched).toHaveLength(1);
  });
});

describe("variableSpend", () => {
  it("counts the owner's card purchases at full value and the Pix nothing planned", () => {
    const days = ledger("2026-07-01", 184, 0, {
      "2026-10-05": { saida: cell(30000, [item(30000, "Aluguel", "contas")]) },
    });
    const spend = variableSpend(
      spendInput({
        ledger: days,
        lines: [
          buy("2026-10-02", 5000),
          // 3 parcels of R$ 100: the purchase is R$ 300.
          buy("2026-10-03", 10000, { installment: 1, installments: 3 }),
          // A later parcel of an older purchase: already counted when it was made.
          buy("2026-10-03", 2000, { installment: 2, installments: 5 }),
          buy("2026-10-04", 9000, { card: "Gio" }),
          buy("2026-10-06", -120000, { description: "PAGAMENTO RECEBIDO" }),
          buy("2026-10-07", -1000, { description: "ESTORNO LOJA" }),
          buy("2026-09-30", 7000),
        ],
        movements: [
          mov("2026-10-05", -30000, "PIX ALUGUEL"),
          mov("2026-10-08", -2500, "PIX PADARIA"),
          mov("2026-10-09", 500000, "SALARIO"),
          mov("2026-10-10", -40000, "PAGAMENTO FATURA"),
          mov("2026-10-11", -10000, "APLICACAO", "reserva"),
          mov("2026-10-12", -8000, "PIX POUPANCA"),
        ],
        savingsAccounts: new Set(["reserva"]),
        savedOrigins: new Set(["pix poupanca"]),
      }),
      d("2026-10-01"),
      d("2026-10-20"),
    );
    expect(spend).toEqual({ cards: 5000 + 30000 - 1000, pix: 2500, total: 36500 });
  });

  it("suggests a day's value from the last 90 days, rounded up to reais", () => {
    const s = suggestDaily(
      spendInput({
        lines: [buy("2026-07-25", 100000), buy("2026-10-19", 1000)],
        movements: [mov("2026-06-01", -1000, "PIX"), mov("2026-09-01", -350000, "PIX MERCADO")],
      }),
    );
    // Cards start on 25/07, so the window does too: 87 days, R$ 4.510 in all.
    expect(s).toMatchObject({ from: "2026-07-25", days: 87, cards: 101000, pix: 350000 });
    expect(s?.perDay).toBe(5200);
  });

  it("does not guess from less than four weeks of bank data", () => {
    expect(
      suggestDaily(
        spendInput({ lines: [buy("2026-10-01", 1000)], movements: [mov("2026-10-01", -1, "X")] }),
      ),
    ).toBeNull();
  });

  it("counts calendar months for the review", () => {
    expect(monthsSince(d("2026-10-09"), d("2027-01-08"))).toBe(2);
    expect(monthsSince(d("2026-10-09"), d("2027-01-09"))).toBe(3);
  });
});

const queue = (over: Partial<QueueInput>) =>
  buildQueue({
    ledger: ledger("2026-10-01", 92, 0),
    cards: [visa],
    today,
    since: d("2026-09-10"),
    movements: [],
    lines: [],
    closed: [],
    othersCards: [],
    accounts: [{ id: "cc", label: "Banco A", use: "corrente" }],
    savedOrigins: new Set(),
    decided: new Set(),
    ...over,
  });

describe("Para lançar: the Diário previsto", () => {
  it("takes the forecast off the days that passed, except one with a Pix still to launch", () => {
    const days = ledger("2026-10-01", 92, 0, {
      "2026-10-17": { diario: forecast(4500) },
      "2026-10-18": { diario: forecast(4500) },
      "2026-10-19": { diario: forecast(4500) },
      "2026-10-20": { diario: forecast(4500) },
    });
    const items = queue({ ledger: days, movements: [mov("2026-10-18", -2000, "PIX FEIRA")] });
    expect(items.map((i) => [i.kind, i.date])).toEqual([
      ["previsto", "2026-10-17"],
      ["diario", "2026-10-18"],
    ]);
    expect(items[0]?.options[0]?.draft).toEqual({
      type: "forecast",
      value: 0,
      days: ["2026-10-17", "2026-10-19"],
    });
  });

  it("offers the forecast for empty days ahead, like a new year tab, only while it is on", () => {
    const days = ledger("2026-10-01", 92, 0, {
      "2026-10-20": { diario: forecast(4500) },
      "2026-10-22": { diario: cell(1000, [item(1000, "Café", null)]) },
    });
    expect(queue({ ledger: days })).toEqual([]);
    const [fill] = queue({ ledger: days, forecast: cents(4500) });
    expect(fill?.key).toBe("previsto:preencher:4500:2026-10-21:2026-12-31:71");
    expect(fill?.options[0]?.draft).toMatchObject({ type: "forecast", value: 4500 });
  });
});

describe("Hoje cabem with the Diário previsto", () => {
  const settings = {
    dailyForecast: cents(5000),
    usualCard: null,
    cycleBudget: null,
    cards: [visa],
    othersCards: [],
  };

  it("follows the month: the Diário against what the bank shows spent before today", () => {
    const p = project(ledger("2026-10-01", 92, 0), today, {
      ...settings,
      previsto: { value: cents(5000), spent: cents(113000) },
    });
    expect(p.canSpend).toMatchObject({
      mode: "month",
      card: "Visa",
      budget: 155000,
      accumulated: 113000,
      daysLeft: 12,
      perDay: 3500,
      closing: "2026-10-31",
      paceExpected: 95000,
      paceGap: -18000,
      daysBehind: 4,
    });
  });

  it("keeps the card's cycle when the Diário previsto is off", () => {
    const p = project(ledger("2026-10-01", 92, 0), today, settings);
    expect(p.canSpend).toMatchObject({ mode: "cycle", daysBehind: 0 });
  });

  it("does not count the forecast as today's logging", () => {
    const days = ledger("2026-10-01", 92, 0, { "2026-10-20": { diario: forecast(4500) } });
    expect(project(days, today, settings).todayLogged).toBe(false);
  });
});
