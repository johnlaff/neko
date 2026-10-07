import { describe, expect, it } from "vitest";
import {
  type CardConfig,
  cents,
  findReimbursed,
  groupUpcomingByDay,
  historyDelta,
  inferDailyForecast,
  localDate,
  project,
  type Settings,
  simulatePurchase,
} from "../src/index.ts";
import { cell, item, ledger } from "./builders.ts";

const visa: CardConfig = { name: "Visa", closingDay: 3, dueDay: 10, closingEstimated: false };
const verde: CardConfig = { name: "Verde", closingDay: 3, dueDay: 10, closingEstimated: false };
const settings = (over: Partial<Settings> = {}): Settings => ({
  dailyForecast: cents(100_00),
  usualCard: "Visa",
  cycleBudget: null,
  cards: [visa],
  othersCards: [],
  ...over,
});

// Oct 1 → Dec 31 2026, R$ 10k on Oct 1, Visa bill of R$ 450 due Nov 10 already on the sheet.
const base = () =>
  ledger("2026-10-01", 92, 10_000_00, {
    "2026-11-10": { saida: cell(450_00, [item(450_00, "Visa")]) },
  });

describe("credit mode projection", () => {
  const today = localDate("2026-10-20");
  const p = project(base(), today, settings());

  it("shows the usual card's open bill as the sheet holds it, with no diário added", () => {
    expect(p.cards[0]).toMatchObject({ onSheet: 450_00, closesInDays: 15 });
    const nov10 = p.series.find((s) => s.date === "2026-11-10");
    expect(nov10?.sheet).toBe(10_000_00 - 450_00);
  });

  it("says how long a purchase today takes to be paid and the card's best day to buy", () => {
    // Visa closes on the 3rd, due on the 10th: bought Oct 20, paid Nov 10 = 21 days.
    expect(p.cards[0]).toMatchObject({ payInDays: 21, bestDay: 4, bestDate: "2026-11-04" });
    // Bought the day after closing, it waits for the next bill: Nov 4 → Dec 10 = 36 days.
    const after = project(base(), localDate("2026-11-04"), settings());
    expect(after.cards[0]).toMatchObject({ payInDays: 36, bestDate: "2026-12-04" });
  });

  it("computes 'pode gastar hoje' per cycle: (budget − already on the bill) / days left", () => {
    // Cycle Oct 3 → Nov 3 = 31 days × R$ 100 = R$ 3.100; minus R$ 450 → R$ 2.650 / 15 days.
    expect(p.canSpend).toMatchObject({
      budget: 3100_00,
      accumulated: 450_00,
      daysLeft: 15,
      perDay: 176_66,
    });
  });

  it("tells whether today's diário is already logged", () => {
    expect(p.todayLogged).toBe(false);
    const l = ledger("2026-10-01", 92, 10_000_00, { "2026-10-20": { diario: cell(42_00) } });
    expect(project(l, today, settings()).todayLogged).toBe(true);
  });

  it("ends each month on the sheet's balance", () => {
    expect(p.months.find((m) => m.month === 11)?.endSheet).toBe(9550_00);
    expect(p.months.find((m) => m.month === 12)?.endSheet).toBe(9550_00);
  });

  it("gives each month's result (the method's performance) from the sheet's balances", () => {
    expect(p.months.map((m) => m.result)).toEqual([0, -450_00, 0]);
  });

  it("a configured cycle budget wins over diário × days", () => {
    expect(project(base(), today, settings({ cycleBudget: cents(2000_00) })).canSpend?.perDay).toBe(
      103_33,
    );
  });

  it("picks the card with the largest past bills when none is chosen, ignoring reimbursed ones", () => {
    const l = ledger("2026-09-01", 122, 0, {
      "2026-09-10": {
        saida: cell(3000_00, [item(1000_00, "Visa"), item(2000_00, "Verde")]),
        entrada: cell(2000_00, [item(2000_00, "Reembolso Verde", null)]),
      },
    });
    const p2 = project(l, today, settings({ usualCard: null, cards: [visa, verde] }));
    expect(p2.cards.find((c) => c.usual)?.card.name).toBe("Visa");
  });

  it("leaves cards someone else pays out of the pace and the usual-card choice", () => {
    const l = ledger("2026-07-01", 153, 0, {
      "2026-07-10": { saida: cell(4000_00, [item(1000_00, "Visa"), item(3000_00, "Verde")]) },
    });
    const s = settings({
      usualCard: null,
      dailyForecast: null,
      cards: [visa, verde],
      othersCards: ["verde"],
    });
    const p3 = project(l, today, s);
    expect(p3.cards.find((c) => c.usual)?.card.name).toBe("Visa");
    expect(p3.cards.find((c) => c.card.name === "Verde")?.others).toBe(true);
    expect(p3.dailyForecast).toBe(11_00); // 1000 / 92 days → 10.87 → 11
  });
});

describe("inferred diário", () => {
  it("averages card and diário spending over the last 3 full months, rounded up to reais", () => {
    const l = ledger("2026-07-01", 92, 0, {
      "2026-07-10": { saida: cell(3000_00, [item(3000_00, "Visa")]) },
      "2026-08-10": { saida: cell(3000_00, [item(3000_00, "Visa"), item(0, "Itau")]) },
      "2026-09-10": {
        saida: cell(3200_00, [item(3000_00, "Visa"), item(200_00, "Luz", "contas")]),
      },
    });
    // 9000 / 92 days = 97.83 → 98
    expect(inferDailyForecast(l, localDate("2026-10-04"))).toBe(98_00);
  });
});

describe("reimbursed cards", () => {
  it("matches an Entrada of the same amount within 15 days, not only the same day", () => {
    const l = ledger("2026-09-01", 30, 0, {
      "2026-09-12": { saida: cell(500_00, [item(300_00, "Visa"), item(200_00, "Verde")]) },
      "2026-09-20": { entrada: cell(200_00, [item(200_00, "Pix Verde", null)]) },
    });
    const r = findReimbursed(l);
    expect([...r].map((i) => i.description)).toEqual(["Verde"]);
  });
  it("honors a #reembolso tag", () => {
    const l = ledger("2026-09-01", 30, 0, {
      "2026-09-12": { saida: cell(200_00, [item(200_00, "Verde #reembolso:Verde")]) },
    });
    expect(findReimbursed(l).size).toBe(1);
  });
});

describe("cycle pace, purchase simulation and bill history", () => {
  const today = localDate("2026-10-20");
  const l = ledger("2026-08-01", 153, 10_000_00, {
    "2026-09-10": { saida: cell(700_00, [item(700_00, "Visa")]) },
    "2026-10-10": { saida: cell(800_00, [item(800_00, "Visa")]) },
    "2026-11-10": { saida: cell(450_00, [item(450_00, "Visa")]) },
  });
  const p = project(l, today, settings());

  it("says how much of the cycle budget the pace allows up to today", () => {
    // Cycle Oct 3 → Nov 3 = 31 days; Oct 4 → Oct 20 = 17 days in, so 17/31 of R$ 3.100.
    expect(p.canSpend).toMatchObject({
      cycleDays: 31,
      paceExpected: 1700_00,
      paceGap: 1250_00,
      overBy: 0,
      due: "2026-11-10",
    });
  });

  it("simulates a purchase today on the usual card", () => {
    const cs = p.canSpend;
    if (!cs) throw new Error("no canSpend");
    // (3.100 − 450 − 300) / 15 days.
    expect(simulatePurchase(cs, cents(300_00))).toEqual({
      perDay: 156_66,
      remaining: 2350_00,
      due: "2026-11-10",
    });
  });

  it("lists past bills of the usual card, oldest first, without the open one", () => {
    expect(p.history.map((h) => [h.due, h.amount])).toEqual([
      ["2026-08-10", 0],
      ["2026-09-10", 700_00],
      ["2026-10-10", 800_00],
    ]);
    // The empty August bill is left out of the mean.
    expect(p.historyAverage).toBe(750_00);
    // Open Nov bill: R$ 450 on the sheet, against a R$ 750 average.
    expect(p.openVsAverage).toBe(-300_00);
  });
});

describe("history delta", () => {
  it("reports how the month-end moved, or null with a single reading", () => {
    expect(historyDelta([{ monthEndProjected: cents(100_00) }])).toBeNull();
    expect(
      historyDelta([{ monthEndProjected: cents(100_00) }, { monthEndProjected: cents(70_00) }]),
    ).toBe(-30_00);
  });
});

describe("upcoming", () => {
  it("leaves out a bill paid back the same day by an income of the same name and amount", () => {
    const l = ledger("2026-10-01", 40, 5_000_00, {
      "2026-10-07": {
        saida: cell(1_080_51, [
          item(1_006_51, "Financiamento Carro 13/36", "contas"),
          item(74_00, "Vivo", "contas"),
        ]),
        entrada: cell(1_006_51, [item(1_006_51, "Financiamento carro 13/36", null)]),
      },
    });
    const p = project(l, localDate("2026-10-05"), settings());
    expect(p.upcoming.map((u) => [u.description, u.kind])).toEqual([["Vivo", "bill"]]);
  });
});

describe("upcoming by day", () => {
  it("groups items by date in order and nets each day, income positive", () => {
    const d1 = localDate("2026-10-05");
    const d2 = localDate("2026-10-07");
    const days = groupUpcomingByDay([
      { date: d1, description: "Vivo", amount: cents(73_28), kind: "bill" },
      { date: d1, description: "Ajuste", amount: cents(10_00), kind: "income" },
      { date: d2, description: "Carro", amount: cents(1006_51), kind: "bill" },
      { date: d2, description: "Carro", amount: cents(1006_51), kind: "income" },
    ]);
    expect(days.map((d) => [d.date, d.items.length, d.net])).toEqual([
      [d1, 2, -63_28],
      [d2, 2, 0],
    ]);
  });
});
