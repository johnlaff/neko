import { SheetStructureError } from "@neko/sheet-reader";
import { describe, expect, it } from "vitest";
import type { ProjectionResponse } from "../src/shared/types.ts";
import {
  eveningMessage,
  morningMessage,
  readFailedMessage,
  remindersView,
} from "../src/worker/push.ts";

const response = (over: Partial<ProjectionResponse["projection"]> = {}) =>
  ({
    projection: {
      today: "2026-10-04",
      todayRef: { tab: "2026", a1: "BB15" },
      canSpend: {
        card: "Visa",
        budget: 3100_00,
        accumulated: 450_00,
        daysLeft: 15,
        perDay: 176_66,
        closing: "2026-11-03",
      },
      ...over,
    },
    sheet: { id: "sheet", tabs: { "2026": 42 } },
  }) as unknown as ProjectionResponse;

describe("reminders", () => {
  it("morning: on Sunday, the week that just closed, when something was logged", () => {
    const sunday = [{ date: "2026-10-04" }];
    const withWeek = (lastWeek: number | null, week = sunday) =>
      morningMessage({ ...response(), habit: { lastWeek, week } } as never)?.body;
    expect(withWeek(6)).toBe(
      "Até a fatura fechar em 3 nov. Faltam 15 dias. Semana passada: 6 de 7 dias lançados.",
    );
    expect(withWeek(1)).toMatch(/Semana passada: 1 de 7 dias lançados\.$/);
    expect(withWeek(0)).not.toMatch(/Semana passada/);
    expect(withWeek(null)).not.toMatch(/Semana passada/);
    expect(withWeek(6, [{ date: "2026-09-27" }])).not.toMatch(/Semana passada/);
  });

  it("morning: the day after a mark or a new best run, one line about it", () => {
    const withHabit = (habit: object) =>
      morningMessage({ ...response(), habit: { week: [], ...habit } } as never)?.body;
    expect(withHabit({ milestone: 21, record: null, editedToday: false })).toMatch(
      / Ontem você chegou a 21 dias seguidos de planilha\.$/,
    );
    expect(withHabit({ milestone: null, record: 10, editedToday: false })).toMatch(
      / Ontem foi seu novo recorde: 11 dias seguidos\.$/,
    );
    // Logged already this morning: the mark is today's, and Hoje shows it.
    expect(withHabit({ milestone: 21, record: null, editedToday: true })).not.toMatch(/Ontem/);
    expect(withHabit({ milestone: null, record: null, editedToday: false })).not.toMatch(/Ontem/);
  });

  it("morning: a card bill due today or in two days earns a line, the only warning before a late fee", () => {
    const bill = (date: string, description = "Roxo", amount = 154_00) => ({
      date,
      description,
      amount,
      kind: "card",
    });
    const body = (upcoming: object[]) =>
      morningMessage(response({ upcoming } as never))?.body ?? "";
    expect(body([bill("2026-10-06")])).toBe(
      "Até a fatura fechar em 3 nov. Faltam 15 dias. A fatura do Roxo vence em 6 out: R$ 154,00.",
    );
    expect(body([bill("2026-10-04")])).toMatch(/ Hoje vence a fatura do Roxo: R\$ 154,00\.$/);
    // Tomorrow was yesterday's two-day warning; other bills and income stay in the app.
    expect(body([bill("2026-10-05")])).not.toMatch(/vence/);
    expect(body([{ ...bill("2026-10-04"), kind: "bill" }])).not.toMatch(/vence/);
    expect(body([bill("2026-10-04", "Roxo"), bill("2026-10-04", "Azul", 99_00)])).toMatch(
      / Hoje vence a fatura do Roxo: R\$ 154,00\. Hoje vence a fatura do Azul: R\$ 99,00\.$/,
    );
    // Without a usual card the morning still warns about the bill.
    expect(
      morningMessage(response({ canSpend: null, upcoming: [bill("2026-10-04")] } as never)),
    ).toEqual({
      title: "Hoje vence a fatura do Roxo",
      body: "R$ 154,00.",
      url: "/faturas",
      tag: "morning",
    });
    expect(morningMessage(response({ canSpend: null, upcoming: [] } as never))).toBeNull();
  });

  it("morning: today's allowance on the usual card, opening Neko", () => {
    expect(morningMessage(response())).toEqual({
      title: "Hoje cabem R$ 176,66 no Visa",
      body: "Até a fatura fechar em 3 nov. Faltam 15 dias.",
      url: "/",
      tag: "morning",
    });
  });
  it("morning: says when the cycle is already over plan", () => {
    const r = response();
    const cs = { ...r.projection.canSpend, perDay: -20_00, accumulated: 3400_00 };
    expect(morningMessage(response({ canSpend: cs } as never)).title).toBe(
      "O Visa passou R$ 300,00 do plano do ciclo",
    );
  });
  it("evening: nudges to log the day, opening the sheet on today's row", () => {
    expect(eveningMessage(response())).toEqual({
      title: "Lançou os gastos de hoje?",
      body: "Abre a planilha direto no dia 4 out.",
      url: "https://docs.google.com/spreadsheets/d/sheet/edit#gid=42&range=BB15",
      tag: "evening",
    });
  });
  it("morning: adds the first red day ahead, and only that kind of warning", () => {
    const red = {
      kind: "goes-negative",
      start: "2026-12-02",
      deepest: -500_00,
      deepestDate: "2026-12-10",
    };
    const up = { kind: "fixed-up", label: "Luz", amount: 300_00, change: 40_00 };
    expect(morningMessage(response({ insights: [red, up] } as never))?.body).toBe(
      "Até a fatura fechar em 3 nov. Faltam 15 dias. O saldo fica negativo em 2 dez.",
    );
    expect(morningMessage(response({ insights: [up] } as never))?.body).toBe(
      "Até a fatura fechar em 3 nov. Faltam 15 dias.",
    );
  });
  it("morning: on the 1st, celebrates what the closed month achieved", () => {
    const recap = {
      month: 9,
      wins: [
        { kind: "blue", months: 3 },
        { kind: "kept", share: 25 },
      ],
    };
    expect(morningMessage(response({ today: "2026-10-01", recap } as never))?.body).toBe(
      "Até a fatura fechar em 3 nov. Faltam 15 dias. Setembro fechou: 3 meses seguidos no azul.",
    );
    expect(morningMessage(response({ today: "2026-10-02", recap } as never))?.body).toBe(
      "Até a fatura fechar em 3 nov. Faltam 15 dias.",
    );
    expect(
      morningMessage(response({ today: "2026-10-01", recap: { month: 9, wins: [] } } as never))
        ?.body,
    ).toBe("Até a fatura fechar em 3 nov. Faltam 15 dias.");
  });
  it("morning: on payday, says how much the method lets you set aside", () => {
    const saving = { date: "2026-10-04", amount: 2_150_00 };
    expect(morningMessage(response({ saving } as never))?.body).toBe(
      "Até a fatura fechar em 3 nov. Faltam 15 dias. Hoje dá para guardar R$ 2.150,00.",
    );
    const later = { date: "2026-10-29", amount: 2_150_00 };
    expect(morningMessage(response({ saving: later } as never))?.body).toBe(
      "Até a fatura fechar em 3 nov. Faltam 15 dias.",
    );
  });
  it("evening: stays quiet when today's diário is already on the sheet", () => {
    expect(eveningMessage(response({ todayLogged: true }))).toBeNull();
  });
  it("evening: stays quiet once the sheet changed today", () => {
    const r = { ...response(), habit: { editedToday: true, streak: 4 } } as never;
    expect(eveningMessage(r)).toBeNull();
  });
  it("evening: states the run as a fact when there is one", () => {
    const r = { ...response(), habit: { editedToday: false, streak: 12 } } as never;
    expect(eveningMessage(r)?.body).toBe(
      "Abre a planilha direto no dia 4 out. Você está há 12 dias em dia.",
    );
  });
  it("sends nothing when there is no card to talk about", () => {
    expect(morningMessage(response({ canSpend: null }))).toBeNull();
  });
  it("hands the app both of today's messages, null when one has nothing to say", () => {
    const data = response({ todayLogged: true });
    expect(remindersView(data)).toEqual({ morning: morningMessage(data), evening: null });
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
