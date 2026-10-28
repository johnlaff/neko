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

  it("corrects a raise on the salary alone when the bank debits the deductions apart", () => {
    // The class paid on salary day is no deduction: the raise is 1.200, not 1.200 plus the class.
    const days = ledger("2026-10-01", 92, 0, {
      "2026-10-29": {
        entrada: cell(600000, [item(600000, "Salário", null)]),
        saida: cell(53200, [
          item(30000, "Previdência", "investimento"),
          item(23200, "Aulas", "contas"),
        ]),
      },
    });
    // The pension as planned, then grown with the salary.
    for (const pension of [-30000, -36000]) {
      const items = queue({
        ledger: days,
        today: d("2026-10-30"),
        movements: [mov("2026-10-29", 720000, "SALARIO"), mov("2026-10-29", pension, "PREV")],
      });
      const salary = items.find((i) => i.kind === "entrada");
      expect(salary?.options.map((o) => o.draft)).toEqual([
        {
          type: "fix",
          line: {
            date: "2026-10-29",
            column: "entrada",
            section: null,
            description: "Salário",
            amount: 600000,
          },
          amount: 720000,
          date: "2026-10-29",
          description: "Salário",
        },
      ]);
    }
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

  it("does not take a planned bill for a payment the sheet already names as something else", () => {
    // The same person gets a ride paid each month; a bill of near value is planned that week.
    const days = ledger("2026-10-01", 92, 0, {
      "2026-10-02": { saida: cell(8000, [item(8000, "Carona", null)]) },
      "2026-11-02": { saida: cell(6528, [item(6528, "Fatura Telefone", "contas")]) },
      "2026-10-04": { saida: cell(7328, [item(7328, "Telefone", "contas")]) },
    });
    const items = queue({
      ledger: days,
      today: d("2026-10-28"),
      movements: [
        mov("2026-10-02", -8000, "Pix enviado Fulano de Tal"),
        mov("2026-10-04", -7328, "Pagamento com Pix OPERADORA TELEFONE S.A."),
        mov("2026-10-27", -8000, "Pix enviado Fulano de Tal"),
        mov("2026-10-28", -7300, "Pagamento com Pix OPERADORA TELEFONE S.A."),
      ],
    });
    expect(items.map((i) => [i.date, i.kind, i.options[0]?.draft])).toMatchObject([
      ["2026-10-27", "diario", { type: "new", description: "Carona" }],
      ["2026-10-28", "conta", { type: "fix", description: "Fatura Telefone" }],
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

  it("a tie still leaves the other planned line for a second payment", () => {
    const days = ledger("2026-10-01", 92, 0, {
      "2026-10-10": {
        saida: cell(20000, [item(10000, "Água", "contas"), item(10000, "Gás", "contas")]),
      },
    });
    const items = queue({
      ledger: days,
      movements: [mov("2026-10-10", -10500, "DEBITO"), mov("2026-10-11", -10300, "DEBITO")],
    });
    expect(items.map((i) => i.kind)).toEqual(["conta", "conta"]);
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

  it("two Pix sent to oneself and one back for the sum are a move, not an Entrada and a Diário", () => {
    // The bank showed both bills paid, plus the owner moving the same money out in two Pix and
    // back in one: the bills are already in the sheet and the three Pix add up to nothing.
    const days = ledger("2026-10-01", 92, 0, {
      "2026-10-10": {
        saida: cell(191535, [item(148474, "Aluguel"), item(43061, "Faculdade")]),
      },
    });
    const items = queue({
      ledger: days,
      movements: [
        mov("2026-10-10", -148474, "Pagamento de conta IMOBILIARIA EXEMPLO LTDA", { id: "a" }),
        mov("2026-10-10", -148474, "Pix enviado Maria Exemplo Silva", { id: "b" }),
        mov("2026-10-10", -43061, "Pagamento com Pix FACULDADE EXEMPLO", { id: "c" }),
        mov("2026-10-10", -43061, "Pix enviado Maria Exemplo Silva", { id: "d" }),
        mov("2026-10-10", 191535, "Pix recebido MARIA EXEMPLO SILVA", { id: "e" }),
      ],
    });
    expect(items).toEqual([]);
  });

  it("a Pix from oneself whose other side the bank has not shown yet is a move, not an Entrada", () => {
    // Earlier moves show the owner's own name on both sides; today one account shows the money
    // coming in, while the account it left is a few days behind at the bank.
    const accounts: QueueInput["accounts"] = [
      { id: "cc", label: "Banco A", use: "corrente" },
      { id: "mp", label: "Banco B", use: "corrente" },
    ];
    const items = queue({
      accounts,
      movements: [
        mov("2026-10-04", -23200, "PIX ENVIADO - DES: Maria Exemplo S 04/10", { id: "a" }),
        mov("2026-10-04", 23200, "Pix recebido MARIA EXEMPLO SILVA", { account: "mp", id: "b" }),
        mov("2026-10-13", 565655, "PIX RECEBIDO - REM: Maria Exemplo S 13/10", { id: "c" }),
        mov("2026-10-13", 40000, "PIX RECEBIDO - REM: Joana Outra Pessoa", { id: "d" }),
      ],
    });
    expect(items.map((i) => [i.kind, i.bank.map((b) => b.description)])).toEqual([
      ["entrada", ["PIX RECEBIDO - REM: Joana Outra Pessoa"]],
    ]);
  });
});

describe("Para lançar: the checking account's automatic investment", () => {
  it("money going into or out of it, and its yield, is the account's own, not an Entrada", () => {
    // The bank sweeps what is left in the account into an automatic investment and back when a
    // Pix needs it; the account balance the sheet follows already counts all of it.
    const items = queue({
      movements: [
        mov("2026-10-14", 1733, "Resgate RES APLIC AUT MAIS", { id: "a" }),
        mov("2026-10-14", 3, "Rendimentos REND PAGO APLIC AUT MAIS", { id: "b" }),
        mov("2026-10-15", -5000, "APLICACAO AUT MAIS", { id: "c" }),
      ],
    });
    expect(items).toEqual([]);
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

  it("shows the purchases behind the rise, and a new purchase's parcels once", () => {
    const [i] = queue({
      ledger: days,
      lines: [
        line("Visa", 41000, "2026-11", { date: d("2026-10-05"), description: "MERCADO" }),
        line("Visa", 1317, "2026-11", { date: d("2026-10-19"), description: "PADARIA" }),
        line("Visa", 3000, "2026-11", {
          date: d("2026-10-18"),
          description: "LOJA PARC 01/02",
          installment: 1,
          installments: 2,
        }),
      ],
    });
    expect(i?.purchases).toEqual([
      {
        due: "2026-11-10",
        exact: true,
        total: 4317,
        lines: [
          expect.objectContaining({ description: "PADARIA", amount: 1317 }),
          expect.objectContaining({ description: "LOJA PARC 01/02", installment: 1 }),
        ],
      },
    ]);
  });

  it("shows the newest on the bill when no lines add up to the rise", () => {
    const [i] = queue({
      ledger: days,
      lines: [
        line("Visa", 40000, "2026-11", { date: d("2026-10-05"), description: "MERCADO" }),
        line("Visa", 2000, "2026-11", { date: d("2026-10-19"), description: "PADARIA" }),
      ],
    });
    expect(i?.purchases).toEqual([
      {
        due: "2026-11-10",
        exact: false,
        total: 42000,
        lines: [
          expect.objectContaining({ description: "PADARIA" }),
          expect.objectContaining({ description: "MERCADO" }),
        ],
      },
    ]);
  });

  it("never counts twice what the sheet already has: it sets the line to the bank's total, once", () => {
    // The sheet holds the parcels and the purchases typed so far; the bank has one more purchase.
    const lines = [
      line("Visa", 30000, "2026-10", { installment: 1, installments: 2 }),
      line("Visa", 11000, "2026-11", { description: "MERCADO" }),
      line("Visa", 4290, "2026-11", { description: "FARMACIA" }),
    ];
    const [i] = queue({ ledger: days, lines });
    expect(i?.options[0]?.draft).toEqual({
      type: "card",
      card: "Visa",
      bills: [{ due: "2026-11-10", was: 41000, amount: 45290 }],
    });
    const launched = ledger("2026-10-01", 130, 0, {
      "2026-11-10": { saida: cell(45290, [item(45290, "Visa")]) },
      "2026-12-12": {
        saida: cell(20000, [item(20000, "Banco Gio")]),
        entrada: cell(20000, [item(20000, "Banco Gio", null)]),
      },
    });
    expect(queue({ ledger: launched, lines })).toEqual([]);
  });

  it("raises an open bill by a real amount only, and sets a closed one to its total", () => {
    expect(queue({ ledger: days, lines: [line("Visa", 30000, "2026-11")] })).toEqual([]);
    // Cents of rounding on the parcels are not worth a change before the bill closes.
    expect(queue({ ledger: days, lines: [line("Visa", 41099, "2026-11")] })).toEqual([]);
    expect(
      queue({ ledger: days, lines: [line("Visa", 41100, "2026-11")] })[0]?.options[0]?.draft,
    ).toMatchObject({ bills: [{ amount: 41100 }] });
    const closed = [{ cards: ["Visa"], billMonth: "2026-11", total: cents(30000) }];
    expect(queue({ ledger: days, closed })[0]?.options[0]?.draft).toMatchObject({
      bills: [{ was: 41000, amount: 30000 }],
    });
  });

  it("pays back the whole bill, and fixes a payback that drifted from a right bill", () => {
    // The sheet's payback (100,00) lags the bill (150,00): raising both by the change keeps it short.
    const drift = ledger("2026-10-01", 130, 0, {
      "2026-12-12": {
        saida: cell(15000, [item(15000, "Banco Gio")]),
        entrada: cell(10000, [item(10000, "Banco Gio", null)]),
      },
    });
    const [raised] = queue({ ledger: drift, lines: [line("Banco Gio", 18000, "2026-12")] });
    expect(raised?.options[0]?.draft).toMatchObject({
      bills: [{ was: 15000, amount: 18000 }],
      also: [{ line: { amount: 10000 }, amount: 18000 }],
    });
    const [fixed] = queue({ ledger: drift, lines: [line("Banco Gio", 15000, "2026-12")] });
    // Launched with "Só a fatura" first: the payback left behind is a new item, not the one decided.
    expect(fixed?.key).not.toBe(raised?.key.replace("18000", "15000"));
    expect(
      queue({
        ledger: drift,
        lines: [line("Banco Gio", 15000, "2026-12")],
        decided: new Set(["card:banco gio:2026-12-12=15000"]),
      }),
    ).toHaveLength(1);
    expect(fixed?.options).toHaveLength(1);
    expect(fixed?.options[0]?.draft).toMatchObject({
      bills: [{ was: 15000, amount: 15000 }],
      also: [{ line: { amount: 10000 }, amount: 15000 }],
    });
  });

  it("asks whether the reimbursement of someone else's card follows its bill", () => {
    const [i] = queue({ ledger: days, lines: [line("Banco Gio", 25000, "2026-12")] });
    // She pays it back: that is what Lançar does unless the owner picks "Só a fatura".
    expect(i?.options.map((o) => o.label)).toEqual(["Fatura e reembolso", "Só a fatura"]);
    expect(i?.options[0]?.draft).toMatchObject({
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

  it("leaves out what moved today, which yesterday's Saldo cannot have yet", () => {
    // The account paid its yield this morning: the balance has it, yesterday's Saldo does not.
    expect(saldoCheck(days, today, [{ ...at(today, 100439), today: cents(439) }])?.diff).toBe(0);
  });
});
