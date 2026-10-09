import { describe, expect, it } from "vitest";
import {
  type BankMovement,
  buildQueue,
  type CardConfig,
  cents,
  type LocalDate,
  localDate,
  originKey,
  placeDraft,
  type QueueInput,
  saldoCheck,
} from "../src/index.ts";
import { cell, item, ledger } from "./builders.ts";

const d = localDate;
const visa: CardConfig = { name: "Visa", closingDay: 3, dueDay: 10, closingEstimated: false };
const gio: CardConfig = { name: "Banco Gio", closingDay: 3, dueDay: 12, closingEstimated: false };
const today = d("2026-10-20");

const mov = (
  date: string,
  amount: number,
  description: string,
  over: Partial<BankMovement> = {},
): BankMovement => ({
  date: d(date),
  amount: cents(amount),
  description,
  account: "cc",
  id: `${date}-${amount}`,
  ...over,
});

const queue = (over: Partial<QueueInput>) =>
  buildQueue({
    ledger: ledger("2026-10-01", 92, 0),
    cards: [visa, gio],
    today,
    since: d("2026-09-10"),
    movements: [],
    lines: [],
    closed: [],
    othersCards: ["Banco Gio"],
    accounts: [{ id: "cc", label: "Banco A", use: "corrente" }],
    savedOrigins: new Set(),
    decided: new Set(),
    ...over,
  });

describe("Para lançar: account movements", () => {
  it("proposes a Pix nobody planned as Diário on its day, with the name the sheet already uses", () => {
    const days = ledger("2026-10-01", 92, 0, {
      "2026-10-02": { diario: cell(1200, [item(1200, "Padaria do Zé", null)]) },
    });
    const items = queue({
      ledger: days,
      movements: [
        mov("2026-10-02", -1200, "PIX ENVIADO 0210 PADARIA"),
        mov("2026-10-15", -1890, "PIX ENVIADO 1510 PADARIA"),
      ],
    });
    expect(items).toEqual([
      {
        key: "mov:2026-10-15--1890",
        kind: "diario",
        date: "2026-10-15",
        bank: [{ date: "2026-10-15", amount: -1890, description: "PIX ENVIADO 1510 PADARIA" }],
        options: [
          {
            label: "",
            draft: {
              type: "new",
              kind: "diario",
              amount: 1890,
              date: "2026-10-15",
              description: "Padaria do Zé",
            },
          },
        ],
      },
    ]);
  });

  it("proposes money in as a new Entrada named after the bank's text", () => {
    const [i] = queue({ movements: [mov("2026-10-05", 588, "Rendimento")] });
    expect(i?.options[0]?.draft).toEqual({
      type: "new",
      kind: "entrada",
      amount: 588,
      date: "2026-10-05",
      description: "Rendimento",
    });
  });

  it("matches the salary net of the deductions planned on its day, and says nothing", () => {
    const days = ledger("2026-10-01", 92, 0, {
      "2026-10-29": {
        entrada: cell(600000, [item(600000, "Salário", null)]),
        saida: cell(30000, [item(30000, "Previdência", "investimento")]),
      },
    });
    expect(
      queue({
        ledger: days,
        today: d("2026-10-30"),
        movements: [mov("2026-10-29", 570000, "SALARIO")],
      }),
    ).toEqual([]);
  });

  it("corrects a planned salary that came different, offering the deduction instead", () => {
    const days = ledger("2026-10-01", 92, 0, {
      "2026-10-29": {
        entrada: cell(600000, [item(600000, "Salário", null)]),
        saida: cell(30000, [item(30000, "Plano de saúde", "contas")]),
      },
    });
    const [i] = queue({
      ledger: days,
      today: d("2026-10-30"),
      movements: [mov("2026-10-30", 575000, "SALARIO")],
    });
    expect(i?.kind).toBe("entrada");
    expect(i?.date).toBe("2026-10-30");
    expect(i?.options.map((o) => [o.label, o.draft])).toEqual([
      [
        "Salário",
        {
          type: "fix",
          line: {
            date: "2026-10-29",
            column: "entrada",
            section: null,
            description: "Salário",
            amount: 600000,
          },
          amount: 605000,
          date: "2026-10-30",
          description: "Salário",
        },
      ],
      [
        "Plano de saúde",
        {
          type: "fix",
          line: {
            date: "2026-10-29",
            column: "saida",
            section: "contas",
            description: "Plano de saúde",
            amount: 30000,
          },
          amount: 25000,
          date: "2026-10-29",
          description: "Plano de saúde",
        },
      ],
    ]);
  });

  it("corrects a planned bill paid with a different value on another day", () => {
    const days = ledger("2026-10-01", 92, 0, {
      "2026-10-10": { saida: cell(15050, [item(15050, "Luz", "contas")]) },
    });
    const [i] = queue({ ledger: days, movements: [mov("2026-10-12", -16230, "DEBITO CONTA LUZ")] });
    expect(i).toMatchObject({ kind: "conta", date: "2026-10-12" });
    expect(i?.options).toEqual([
      {
        label: "",
        draft: {
          type: "fix",
          line: {
            date: "2026-10-10",
            column: "saida",
            section: "contas",
            description: "Luz",
            amount: 15050,
          },
          amount: 16230,
          date: "2026-10-12",
          description: "Luz",
        },
      },
    ]);
  });

  it("asks which line when two planned ones fit the same", () => {
    const days = ledger("2026-10-01", 92, 0, {
      "2026-10-10": {
        saida: cell(20000, [item(10000, "Água", "contas"), item(10000, "Gás", "contas")]),
      },
    });
    const [i] = queue({ ledger: days, movements: [mov("2026-10-10", -10500, "DEBITO")] });
    expect(i?.options.map((o) => o.label)).toEqual(["Água de 2026-10-10", "Gás de 2026-10-10"]);
  });

  it("leaves out what was launched or ignored, and what is older than the window", () => {
    const movements = [mov("2026-10-15", -1890, "PIX"), mov("2026-09-01", -500, "PIX")];
    expect(queue({ movements, decided: new Set(["mov:2026-10-15--1890"]) })).toEqual([]);
  });

  it("proposes savings for an origin launched as savings before", () => {
    const [i] = queue({
      movements: [mov("2026-10-15", -50000, "PIX ENVIADO CORRETORA")],
      savedOrigins: new Set([originKey("PIX ENVIADO CORRETORA")]),
    });
    expect(i).toMatchObject({
      kind: "guardar",
      options: [{ draft: { kind: "reserva", amount: 50000 } }],
    });
  });
});

describe("Para lançar: the owner's own accounts", () => {
  const accounts: QueueInput["accounts"] = [
    { id: "cc", label: "Banco A", use: "corrente" },
    { id: "poup", label: "Caixinha", use: "guardado" },
    { id: "novo", label: "Banco C", use: null },
  ];
  it("money into a savings account is a Reserva Saída; back out is a Reserva Entrada", () => {
    const items = queue({
      accounts,
      movements: [
        mov("2026-10-05", -50000, "TED", { account: "cc", id: "a" }),
        mov("2026-10-05", 50000, "TED", { account: "poup", id: "b" }),
        mov("2026-10-15", -20000, "RESGATE", { account: "poup", id: "c" }),
        mov("2026-10-15", 20000, "RESGATE", { account: "cc", id: "d" }),
        mov("2026-10-16", 31, "RENDIMENTO", { account: "poup", id: "e" }),
      ],
    });
    expect(items.map((i) => [i.kind, i.date, i.options[0]?.draft])).toEqual([
      [
        "guardar",
        "2026-10-05",
        {
          type: "new",
          kind: "reserva",
          amount: 50000,
          date: "2026-10-05",
          description: "Caixinha",
        },
      ],
      [
        "resgate",
        "2026-10-15",
        {
          type: "new",
          kind: "resgate",
          amount: 20000,
          date: "2026-10-15",
          description: "Caixinha",
        },
      ],
    ]);
  });

  it("asks once what a new account is for", () => {
    const items = queue({
      accounts,
      movements: [
        mov("2026-10-05", -1000, "TED", { account: "cc", id: "a" }),
        mov("2026-10-05", 1000, "TED", { account: "novo", id: "b" }),
        mov("2026-10-06", -2000, "TED", { account: "cc", id: "c" }),
        mov("2026-10-06", 2000, "TED", { account: "novo", id: "d" }),
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: "conta:novo", kind: "conta-propria" });
    expect(items[0]?.options.map((o) => o.answer)).toEqual(["guardado", "corrente"]);
  });
});

describe("Para lançar: card bills", () => {
  const days = ledger("2026-10-01", 130, 0, {
    "2026-11-10": { saida: cell(41000, [item(41000, "Visa")]) },
    "2026-12-12": {
      saida: cell(20000, [item(20000, "Banco Gio")]),
      entrada: cell(20000, [item(20000, "Banco Gio", null)]),
    },
  });
  const line = (card: string, amount: number, billMonth: string, over = {}) => ({
    card,
    amount: cents(amount),
    billMonth,
    description: "LOJA",
    installment: null,
    installments: null,
    ...over,
  });

  it("raises a bill to the bank's total, and the parcels of a new purchase in one item", () => {
    const [i] = queue({
      ledger: days,
      lines: [
        line("Visa", 45290, "2026-11"),
        line("Visa", 10000, "2026-12", { installment: 1, installments: 2 }),
      ],
    });
    expect(i).toMatchObject({ kind: "cartao", date: "2026-11-10" });
    expect(i?.options[0]?.draft).toEqual({
      type: "card",
      card: "Visa",
      bills: [
        { due: "2026-11-10", was: 41000, amount: 45290 },
        { due: "2026-12-10", was: 0, amount: 10000 },
        { due: "2027-01-10", was: 0, amount: 10000 },
      ],
    });
  });

  it("lowers an open bill only by rounding, and a closed one to its total", () => {
    expect(queue({ ledger: days, lines: [line("Visa", 30000, "2026-11")] })).toEqual([]);
    expect(
      queue({ ledger: days, lines: [line("Visa", 40999, "2026-11")] })[0]?.options[0]?.draft,
    ).toMatchObject({
      bills: [{ amount: 40999 }],
    });
    const closed = [{ card: "Visa", billMonth: "2026-11", total: cents(30000) }];
    expect(queue({ ledger: days, closed })[0]?.options[0]?.draft).toMatchObject({
      bills: [{ was: 41000, amount: 30000 }],
    });
  });

  it("asks whether the reimbursement of someone else's card follows its bill", () => {
    const [i] = queue({ ledger: days, lines: [line("Banco Gio", 25000, "2026-12")] });
    expect(i?.options.map((o) => o.label)).toEqual(["Só a fatura", "Fatura e reembolso"]);
    expect(i?.options[1]?.draft).toMatchObject({
      also: [
        {
          line: { date: "2026-12-12", column: "entrada", description: "Banco Gio", amount: 20000 },
          amount: 25000,
        },
      ],
    });
  });
});

describe("placeDraft", () => {
  const line = {
    date: d("2026-10-29"),
    column: "entrada",
    section: null,
    description: "Salário",
    amount: cents(600000),
  } as const;
  it("changes a line in place, or moves it when the day or the name changes", () => {
    expect(
      placeDraft(
        { type: "fix", line, amount: cents(605000), date: line.date, description: "Salário" },
        [],
      ),
    ).toEqual([
      {
        date: "2026-10-29",
        column: "entrada",
        section: null,
        description: "Salário",
        target: "line",
        was: 600000,
        amount: 605000,
      },
    ]);
    expect(
      placeDraft(
        { type: "fix", line, amount: cents(605000), date: d("2026-10-30"), description: "Salário" },
        [],
      ),
    ).toEqual([
      {
        date: "2026-10-29",
        column: "entrada",
        section: null,
        description: "Salário",
        target: "line",
        was: 600000,
        amount: 0,
      },
      {
        date: "2026-10-30",
        column: "entrada",
        section: null,
        description: "Salário",
        target: "line",
        amount: 605000,
      },
    ]);
  });
  it("moves the Economia with a planned saving: the change in its month, or out of one into another", () => {
    const kept = {
      ...line,
      column: "saida",
      section: "reserva",
      description: "Reserva",
      amount: cents(50000),
    } as const;
    const same = placeDraft(
      { type: "fix", line: kept, amount: cents(60000), date: kept.date, description: "Reserva" },
      [],
    );
    expect(same.filter((p) => p.target === "economia")).toEqual([
      {
        date: "2026-10-01",
        column: "saida",
        section: null,
        amount: 10000,
        description: "Economia",
        target: "economia",
      },
    ]);
    const moved = placeDraft(
      {
        type: "fix",
        line: kept,
        amount: cents(50000),
        date: d("2026-11-02"),
        description: "Reserva",
      },
      [],
    );
    expect(moved.filter((p) => p.target === "economia")).toEqual([
      {
        date: "2026-10-01",
        column: "entrada",
        section: null,
        amount: 50000,
        description: "Economia",
        target: "economia",
      },
      {
        date: "2026-11-01",
        column: "saida",
        section: null,
        amount: 50000,
        description: "Economia",
        target: "economia",
      },
    ]);
  });
  it("sets each card bill and its reimbursement", () => {
    const ps = placeDraft(
      {
        type: "card",
        card: "Banco Gio",
        bills: [{ due: d("2026-12-12"), was: cents(20000), amount: cents(25000) }],
        also: [
          {
            line: {
              ...line,
              date: d("2026-12-12"),
              description: "Banco Gio",
              amount: cents(20000),
            },
            amount: cents(25000),
          },
        ],
      },
      [],
    );
    expect(ps.map((p) => [p.column, p.target, p.was, p.amount])).toEqual([
      ["saida", "card", 20000, 25000],
      ["entrada", "line", 20000, 25000],
    ]);
  });
});

describe("saldo bate", () => {
  const days = ledger("2026-10-01", 30, 100000);
  const at = (readOn: LocalDate | null, balance: number, label = "Banco A") => ({
    label,
    balance: cents(balance),
    readOn,
  });
  it("compares yesterday's Saldo with the accounts and names a bank not read today", () => {
    expect(
      saldoCheck(days, today, [at(today, 60000), at(d("2026-10-18"), 40000, "Banco B")]),
    ).toEqual({
      date: "2026-10-19",
      sheet: 100000,
      bank: 100000,
      diff: 0,
      stale: ["Banco B"],
    });
    expect(saldoCheck(days, today, [at(today, 101836)])?.diff).toBe(1836);
    expect(saldoCheck(days, today, [])).toBeNull();
  });
});
