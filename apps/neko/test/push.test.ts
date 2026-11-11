import { SheetStructureError } from "@neko/sheet-reader";
import { describe, expect, it } from "vitest";
import type { ProjectionResponse } from "../src/shared/types.ts";
import {
  eveningMessage,
  morningMessage,
  PARA_LANCAR,
  readFailedMessage,
} from "../src/worker/push.ts";

// Invented bills, cards and amounts (public repo). 2026-10-06 is a Tuesday, 2026-10-04 a Sunday.
const TUESDAY = "2026-10-06";
const SUNDAY = "2026-10-04";

const response = (over: Partial<ProjectionResponse["projection"]> = {}, rest: object = {}) =>
  ({
    projection: {
      today: TUESDAY,
      todayRef: { tab: "2026", a1: "BB17" },
      canSpend: {
        mode: "cards",
        card: "",
        budget: 3500_00,
        accumulated: 1800_00,
        left: 1700_00,
        overBy: 0,
        daysLeft: 26,
        closing: "2026-10-31",
        used: 50,
      },
      upcoming: [],
      insights: [],
      saving: null,
      ...over,
    },
    sheet: { id: "sheet", tabs: { "2026": 42 } },
    ...rest,
  }) as unknown as ProjectionResponse;

const bill = (date: string, description: string, amount: number, kind = "bill") => ({
  date,
  description,
  amount,
  kind,
});
/** The sheet's balance at the end of each day of October 2026. */
const balances = (days: Record<number, number>) => [
  {
    year: 2026,
    month: 10,
    days: Object.entries(days).map(([day, balance]) => ({ day: Number(day), balance })),
  },
];
const red = (start: string, already = false) => ({
  kind: "goes-negative",
  start,
  deepest: -500_00,
  deepestDate: start,
  already,
});
const cardsMode = response().projection.canSpend;

describe("morning", () => {
  it("stays quiet when there is nothing to do: what still fits lives on the widget", () => {
    expect(morningMessage(response())).toBeNull();
    // Bills further ahead, a red day far off and income today are Hoje's, not a reason to call.
    expect(
      morningMessage(
        response({
          upcoming: [
            bill(TUESDAY, "Salário", 7000_00, "income"),
            bill("2026-10-08", "Roxo", 154_00, "card"),
          ],
          insights: [red("2026-10-20")],
        } as never),
      ),
    ).toBeNull();
    expect(morningMessage(response({ canSpend: null } as never))).toBeNull();
  });

  it("leads with every bill due today, cards or not", () => {
    expect(
      morningMessage(
        response({
          upcoming: [
            bill(TUESDAY, "Aluguel", 1484_24),
            bill(TUESDAY, "Faculdade", 312_12),
            bill(TUESDAY, "Roxo", 154_00, "card"),
            bill(TUESDAY, "Salário", 7000_00, "income"),
          ],
        } as never),
      ),
    ).toEqual({
      title: "Vencem hoje 3 contas: R$ 1.950,36",
      body: "Aluguel R$ 1.484,24, Faculdade R$ 312,12 e fatura do Roxo R$ 154,00.",
      url: "/",
      tag: "morning",
    });
    // Only card bills: Faturas is where they are.
    expect(
      morningMessage(response({ upcoming: [bill(TUESDAY, "Roxo", 154_00, "card")] } as never)),
    ).toEqual({
      title: "Vence hoje: fatura do Roxo, R$ 154,00",
      body: "",
      url: "/faturas",
      tag: "morning",
    });
  });

  it("says how much the account misses to pay today's bills, so the bill does not go to the overdraft", () => {
    const m = morningMessage(
      response({
        upcoming: [bill(TUESDAY, "Aluguel", 1484_24), bill(TUESDAY, "Roxo", 154_00, "card")],
        months: balances({ 6: -230_00 }),
        insights: [red(TUESDAY)],
      } as never),
    );
    expect(m?.body).toBe(
      "Aluguel R$ 1.484,24 e fatura do Roxo R$ 154,00. Para pagar, faltam R$ 230,00 na conta.",
    );
    // The red day is today's: the bills already said it.
    expect(m?.body).not.toMatch(/negativo/);
  });

  it("asks to move money into the account a bill is debited from, before the due day", () => {
    const transfer = (bills: object[]) => ({
      bank: { transfers: [{ to: "Banco Azul", amount: 1200_00, balance: 5000_00, bills }] },
    });
    const one = morningMessage(
      response({}, transfer([{ card: "Azul", due: "2026-10-08", amount: 6200_00 }])),
    );
    expect(one).toEqual({
      title: "Transfira R$ 1.200,00 para a conta Banco Azul",
      body: "A fatura do Azul, R$ 6.200,00, sai dessa conta em 8 out, e ela tem R$ 5.000,00.",
      url: "/faturas",
      tag: "morning",
    });
    // Holder and additional card make one bill, debited in full.
    const two = morningMessage(
      response(
        {},
        transfer([
          { card: "Azul Titular", due: "2026-10-07", amount: 4500_00 },
          { card: "Azul Adicional", due: "2026-10-07", amount: 1700_00 },
        ]),
      ),
    );
    expect(two?.body).toBe(
      "As faturas do Azul Titular R$ 4.500,00 e do Azul Adicional R$ 1.700,00 saem dessa conta amanhã, e ela tem R$ 5.000,00.",
    );
    // On the due day it follows the bills' own line.
    const today = morningMessage(
      response(
        { upcoming: [bill(TUESDAY, "Azul", 6200_00, "card")] } as never,
        transfer([{ card: "Azul", due: TUESDAY, amount: 6200_00 }]),
      ),
    );
    expect(today?.title).toBe("Vence hoje: fatura do Azul, R$ 6.200,00");
    expect(today?.body).toBe(
      "Transfira R$ 1.200,00 para a conta Banco Azul. A fatura do Azul, R$ 6.200,00, sai dessa conta hoje, e ela tem R$ 5.000,00.",
    );
  });

  it("warns of the balance going red now or within two days, with what is due that day", () => {
    expect(
      morningMessage(
        response({
          upcoming: [bill("2026-10-08", "Verde", 3230_00, "card")],
          months: balances({ 6: 1200_00, 8: -2030_00 }),
          insights: [red("2026-10-08")],
        } as never),
      ),
    ).toEqual({
      title: "O saldo fica negativo em 8 out",
      body: "Faltam R$ 2.030,00 na conta nesse dia. Vence: fatura do Verde R$ 3.230,00.",
      url: "/",
      tag: "morning",
    });
    expect(
      morningMessage(
        response({ months: balances({ 6: -80_00 }), insights: [red(TUESDAY, true)] } as never),
      ),
    ).toEqual({
      title: "O saldo está negativo",
      body: "No fim de hoje, faltam R$ 80,00 na conta.",
      url: "/",
      tag: "morning",
    });
    expect(morningMessage(response({ insights: [red("2026-10-09")] } as never))).toBeNull();
  });

  it("on payday, says how much the method lets you set aside", () => {
    const saving = { date: TUESDAY, amount: 2150_00, until: "2026-10-30", leftAtLowest: 800_00 };
    expect(morningMessage(response({ saving } as never))).toEqual({
      title: "Hoje dá para guardar R$ 2.150,00",
      body: "Depois de guardar, o menor saldo até 30 out fica em R$ 800,00.",
      url: "/",
      tag: "morning",
    });
    expect(
      morningMessage(response({ saving: { ...saving, date: "2026-10-29" } } as never)),
    ).toBeNull();
  });

  it("says the ceiling crossed 75% or 100%, only on the morning that has the news", () => {
    const at = (left: number, overBy = 0) =>
      response({
        canSpend: { ...cardsMode, left, overBy, used: overBy > 0 || left === 0 ? 100 : 75 },
      } as never);
    expect(morningMessage(at(800_00), 75)).toMatchObject({
      title: "Cartões e Pix passaram de 75% do teto",
      body: "Ainda cabem R$ 800,00 até o fim do mês.",
    });
    expect(morningMessage(at(0), 100)).toMatchObject({
      title: "Cartões e Pix chegaram ao teto",
      body: "O teto do mês é R$ 3.500,00.",
    });
    expect(morningMessage(at(0, 100_00), 100)?.title).toBe(
      "Cartões e Pix passaram R$ 100,00 do teto",
    );
    expect(morningMessage(at(800_00))).toBeNull();
    // Only the ceiling has marks; the usual card's cycle does not.
    expect(
      morningMessage(response({ canSpend: { ...cardsMode, mode: "cycle" } } as never), 75),
    ).toBeNull();
  });

  it("on Sunday, the week that closed: cards and Pix against the week before, and the days logged", () => {
    const week = { from: "2026-09-27", to: "2026-10-03", total: 812_40, previous: 932_40 };
    const sunday = (w: object | null, lastWeek: number | null) =>
      morningMessage(response({ today: SUNDAY } as never, { week: w, habit: { lastWeek } }));
    expect(sunday(week, 5)).toEqual({
      title: "Semana passada: R$ 812,40 em cartões e Pix",
      body: "R$ 120,00 a menos que na semana anterior. 5 de 7 dias lançados.",
      url: "/",
      tag: "morning",
    });
    expect(sunday({ ...week, total: 1000_00 }, 0)?.body).toBe(
      "R$ 67,60 a mais que na semana anterior.",
    );
    expect(sunday({ ...week, previous: null }, 7)?.body).toBe("7 de 7 dias lançados.");
    expect(sunday(null, 5)).toMatchObject({
      title: "Semana passada: 5 de 7 dias lançados",
      body: "",
    });
    expect(sunday(null, 0)).toBeNull();
    // Any other day, the week waits for Sunday.
    expect(morningMessage(response({}, { week, habit: { lastWeek: 5 } }))).toBeNull();
  });

  it("puts the most urgent in the title and the rest in one line each", () => {
    const m = morningMessage(
      response(
        {
          today: SUNDAY,
          upcoming: [
            bill(SUNDAY, "Aluguel", 1484_24),
            bill("2026-10-06", "Verde", 3230_00, "card"),
          ],
          months: balances({ 4: 1000_00, 6: -2030_00 }),
          insights: [red("2026-10-06")],
          saving: { date: SUNDAY, amount: 500_00, until: "2026-10-30", leftAtLowest: 100_00 },
          canSpend: { ...cardsMode, left: 800_00, used: 75 },
        } as never,
        { week: { total: 812_40, previous: 812_40 }, habit: { lastWeek: 6 } },
      ),
      75,
    );
    expect(m?.title).toBe("Vence hoje: Aluguel, R$ 1.484,24");
    expect(m?.body).toBe(
      [
        "O saldo fica negativo em 6 out. Faltam R$ 2.030,00 na conta nesse dia. Vence: fatura do Verde R$ 3.230,00.",
        "Hoje dá para guardar R$ 500,00.",
        "Cartões e Pix passaram de 75% do teto: ainda cabem R$ 800,00.",
        "Semana passada: R$ 812,40 em cartões e Pix, o mesmo que na semana anterior, 6 de 7 dias lançados.",
      ].join(" "),
    );
  });
});

const item = (title: string) => ({ key: title, kind: "diario", date: TUESDAY, title });
const withQueue = (titles: string[], rest: object = {}) =>
  response({}, { writing: true, bank: { queue: titles.map(item) }, ...rest });

describe("evening", () => {
  it("counts and names what waits in Para lançar, and opens right on it", () => {
    expect(eveningMessage(withQueue(["Padaria", "PIX FEIRA DO BAIRRO", "Inter"]))).toEqual({
      title: "3 para lançar",
      body: "Padaria, Pix Feira do Bairro e Inter.",
      url: PARA_LANCAR,
      tag: "evening",
    });
    expect(eveningMessage(withQueue(["A", "B", "C", "D", "E"]))?.body).toBe("A, B, C e mais 2.");
    expect(eveningMessage(withQueue(["Padaria"]))?.title).toBe("1 para lançar");
  });

  it("still counts the queue once the sheet changed today: those items are not on it yet", () => {
    expect(
      eveningMessage(withQueue(["Padaria"], { habit: { editedToday: true, streak: 4 } })),
    ).toMatchObject({ title: "1 para lançar", body: "Padaria. Você está há 4 dias em dia." });
  });

  it("leads the mend with the run that tonight's launch keeps going", () => {
    const atRisk = { habit: { editedToday: false, streak: 12, atRisk: true } };
    expect(eveningMessage(withQueue(["Padaria"], atRisk))?.body).toBe(
      "Padaria. Ontem ficou sem lançar. Lance hoje e a sequência de 12 dias continua.",
    );
  });

  it("with Para lançar empty, asks about the day until the sheet changes", () => {
    expect(eveningMessage(withQueue([]))).toEqual({
      title: "Lançou o dia?",
      body: "Abre o Neko para lançar o dia.",
      url: "/",
      tag: "evening",
    });
    const atRisk = { habit: { editedToday: false, streak: 1, atRisk: true } };
    expect(eveningMessage(withQueue([], atRisk))?.body).toBe(
      "Ontem ficou sem lançar. Lance hoje e a sequência de 1 dia continua.",
    );
    expect(eveningMessage(withQueue([], { habit: { editedToday: true, streak: 4 } }))).toBeNull();
    expect(eveningMessage(response({ todayLogged: true }, { writing: true }))).toBeNull();
  });

  it("with writing off, nothing launches from Neko: the nudge opens today's row in the sheet", () => {
    expect(eveningMessage(withQueue(["Padaria"], { writing: false }))).toEqual({
      title: "Lançou o dia?",
      body: "Abre a planilha direto no dia 6 out.",
      url: "https://docs.google.com/spreadsheets/d/sheet/edit#gid=42&range=BB17",
      tag: "evening",
    });
  });
});

describe("read failure alert", () => {
  it("says the sheet changed shape when the reader refuses its structure", () => {
    expect(readFailedMessage(new SheetStructureError("x"))).toMatchObject({
      title: "Não consegui ler a planilha",
      body: "Alguma aba ou coluna mudou de lugar. Os números do Neko são da última leitura.",
      tag: "alert",
    });
  });
  it("says it will retry on any other failure", () => {
    expect(readFailedMessage(new Error("network")).body).toBe(
      "Tento de novo na próxima atualização. Os números do Neko são da última leitura.",
    );
  });
});
