import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cents, ownerKey, paceMonthly, simulateInstallments } from "@neko/engine";
import { describe, expect, it } from "vitest";
import {
  ajustesView,
  invoicesView,
  monthsView,
  scenarioView,
  scenarioViews,
  simulateView,
} from "../src/shared/screens.ts";
import { type ProjectionResponse, UserSettings } from "../src/shared/types.ts";
import type { Env } from "../src/worker/env.ts";
import worker from "../src/worker/index.ts";

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "e2e", "projection.json"), "utf8"),
) as ProjectionResponse;

type Cards = ProjectionResponse["projection"]["cards"];

/** The fixture's cards replaced, to try the screen's groupings. */
const withCards = (cards: Cards): ProjectionResponse => ({
  ...fixture,
  projection: { ...fixture.projection, cards },
});

const card = (
  name: string,
  over: Partial<Cards[number]> & { due?: string; estimated?: boolean } = {},
): Cards[number] => {
  const { due = "2026-11-12", estimated = false, ...rest } = over;
  return {
    card: { name, dueDay: 12, closingDay: 5, closingEstimated: estimated },
    cycle: { start: "2026-10-06", closing: "2026-11-05", due },
    onSheet: 100_00,
    closesInDays: 31,
    payInDays: 38,
    bestDay: 6,
    bestDate: "2026-11-06",
    reimbursed: false,
    others: false,
    usual: false,
    ...rest,
  };
};

describe("invoices view", () => {
  it("lists each month with every card due in it, opening on the next bill to pay", () => {
    const v = invoicesView(fixture);
    expect(v.current).toBe(fixture.projection.invoiceMonth);
    const now = v.months.find((m) => m.key === v.current);
    expect(now?.cards.map((c) => c.card)).toEqual(expect.arrayContaining(["Cartão Azul"]));
    expect(now?.total).toBe(now?.cards.reduce((t, c) => t + c.amount, 0));
    expect(v.months.at(0)?.past).toBe(true);
    expect(v.average).toBe(fixture.projection.invoicesAverage);
  });

  it("puts the bank's side on each card and only flags a real disagreement", () => {
    const v = invoicesView(fixture);
    const checked = v.months.flatMap((m) => m.cards).filter((c) => c.bank !== null);
    expect(checked.length).toBeGreaterThan(0);
    for (const c of checked) expect(c.bank?.disagrees).toBe((c.bank?.gap ?? 0) > 0);
    const m = v.months.find((x) => x.bank !== null);
    expect(m?.bank?.disagree).toBe(m?.cards.filter((c) => c.bank?.disagrees).length);
  });

  it("gives each card its own history across the months shown", () => {
    const v = invoicesView(fixture);
    const azul = v.months.flatMap((m) => m.cards).find((c) => c.card === "Cartão Azul");
    expect(azul?.history.map((h) => h.month)).toEqual(v.months.map((m) => m.key));
  });

  it("leaves the buying choice out with a single card of your own", () => {
    expect(invoicesView(fixture).buyToday).toEqual([]);
  });

  it("groups your cards that charge on the same dates, longest wait first", () => {
    const v = invoicesView(
      withCards([
        card("Azul", { usual: true, payInDays: 10, due: "2026-10-12", bestDate: "2026-10-06" }),
        card("Amazon", { estimated: true }),
        card("Itau"),
        card("Lia", { others: true, payInDays: 60 }),
        card("Vazio", { onSheet: 0 }),
      ]),
    );
    expect(v.buyToday).toEqual([
      {
        cards: ["Amazon", "Itau"],
        payInDays: 38,
        due: "2026-11-12",
        bestDate: "2026-11-06",
        estimated: true,
      },
      {
        cards: ["Azul"],
        payInDays: 10,
        due: "2026-10-12",
        bestDate: "2026-10-06",
        estimated: false,
      },
    ]);
  });

  it("says when the sheet has no card", () => {
    const v = invoicesView(withCards([]));
    expect(v).toMatchObject({ hasCards: false, buyToday: [] });
  });
});

describe("parcels view", () => {
  type Check = NonNullable<ProjectionResponse["bank"]>["checks"][number];
  type Line = Check["lines"][number];
  const parcel = (
    description: string,
    amount: number,
    billMonth: string,
    installment: number,
    installments: number,
    cardName = "Cartão Azul",
  ) =>
    ({
      card: cardName,
      amount,
      billMonth,
      description,
      installment,
      installments,
      date: "2026-07-03",
    }) as Line;
  const check = (cardName: string, due: string, lines: Line[], sheet?: number): Check => {
    const bank = lines.reduce((t, l) => t + l.amount, 0);
    return {
      card: cardName,
      due,
      bank,
      parcels: bank,
      sheet: sheet ?? bank,
      gap: bank - (sheet ?? bank),
      closed: false,
      disagrees: false,
      lines,
    } as Check;
  };
  const sofa = parcel("SOFA CASA 04/10", 300_00, "2026-10", 4, 10);
  const lia = { key: ownerKey(sofa as never) ?? "", person: "Lia", share: 150_00 };
  /** September's bill already due, October's to pay, and a card the owner's friend Lia pays. */
  const bills = (sheet?: number) => [
    check("Cartão Azul", "2026-09-12", [
      parcel("NOTEBOOK 04/10", 420_00, "2026-09", 4, 10),
      parcel("CURSO ONLINE 12/12", 97_00, "2026-09", 12, 12),
    ]),
    check(
      "Cartão Azul",
      "2026-10-12",
      [
        parcel("NOTEBOOK 05/10", 420_00, "2026-10", 5, 10),
        parcel("TENIS CORRIDA 01/03", 80_00, "2026-10", 1, 3),
        sofa,
      ],
      sheet,
    ),
    check("Cartão da Lia", "2026-10-12", [
      parcel("SMARTPHONE 06/10", 150_00, "2026-10", 6, 10, "Cartão da Lia"),
    ]),
  ];
  const withBills = (checks: Check[]): ProjectionResponse => {
    const p = fixture.projection;
    if (!p.canSpend || !fixture.bank) throw new Error("fixture has a usual card and a bank");
    return {
      ...fixture,
      projection: {
        ...p,
        cards: [...p.cards, card("Cartão da Lia", { others: true })],
        canSpend: { ...p.canSpend, budgetSource: "configured", budget: cents(3_000_00) },
      },
      bank: { ...fixture.bank, checks, owners: [lia] },
    };
  };

  it("adds up the owner's parcels on the month's bills, with their weight and what changed", () => {
    const v = invoicesView(withBills(bills()));
    expect(v.parcels?.month).toBe(fixture.projection.invoiceMonth);
    const [mine, theirs, ...rest] = v.parcels?.sides ?? [];
    expect(rest).toEqual([]);
    const income = fixture.projection.months.find((m) => m.year === 2026 && m.month === 10);
    expect(mine).toMatchObject({
      person: null,
      count: 3,
      // The notebook, the sneakers and the owner's half of the sofa.
      now: 650_00,
      ofIncome: Math.round((650_00 * 100) / (income?.ownIncome ?? 1)),
      ofCeiling: 22,
      previous: { month: "2026-09", amount: 667_00, started: 1, ended: 1 },
      left: 420_00 * 6 + 80_00 * 3 + 150_00 * 7,
      last: "2027-04",
    });
    expect(mine?.months.map((m) => [m.key, m.amount, m.ending])).toEqual([
      ["2026-10", 650_00, []],
      ["2026-11", 650_00, []],
      ["2026-12", 650_00, ["TENIS CORRIDA 01/03"]],
      ["2027-01", 570_00, []],
      ["2027-02", 570_00, []],
      ["2027-03", 570_00, ["NOTEBOOK 04/10"]],
      ["2027-04", 150_00, ["SOFA CASA 04/10"]],
    ]);
    expect(mine?.months[3]?.ofCeiling).toBe(19);
    expect(mine?.groups.map((g) => [g.last, g.frees, g.plans.length])).toEqual([
      ["2026-12", 80_00, 1],
      ["2027-03", 420_00, 1],
      ["2027-04", 150_00, 1],
    ]);
    expect(mine?.groups[1]?.plans[0]).toMatchObject({
      card: "Cartão Azul",
      installment: 5,
      installments: 10,
      first: "2026-06",
      amount: 420_00,
      part: 420_00,
      paid: 420_00 * 4,
      left: 420_00 * 6,
      person: null,
    });
    expect(mine?.groups[2]?.plans[0]).toMatchObject({
      key: lia.key,
      part: 150_00,
      person: "Lia",
      share: 150_00,
      theirCard: false,
    });
    expect(mine?.ended).toMatchObject({ month: "2026-09", amount: 97_00 });
    expect(mine?.ended?.plans[0]).toMatchObject({ installment: 12, left: 0 });
    // Lia's: her half of the sofa and the phone on her own card, out of the owner's income.
    expect(theirs).toMatchObject({ person: "Lia", count: 2, now: 300_00, ofIncome: null });
    expect(theirs?.groups.flatMap((g) => g.plans.map((p) => [p.description, p.theirCard]))).toEqual(
      [
        ["SMARTPHONE 06/10", true],
        ["SOFA CASA 04/10", false],
      ],
    );
    expect(v.parcels?.short).toEqual([]);
    expect(v.parcels?.shortBy).toBe(0);
    expect(v.parcels?.leftOut).toEqual([]);
  });

  it("names a bill whose sheet amount is short of its parcels, and a card with nothing to read", () => {
    const short = invoicesView(withBills(bills(500_00)));
    expect(short.parcels?.short).toEqual([
      { card: "Cartão Azul", due: "2026-10-12", missing: 300_00 },
    ]);
    expect(short.parcels?.shortBy).toBe(300_00);
    const only = invoicesView(withBills(bills().slice(2)));
    expect(only.parcels?.sides.map((s) => s.person)).toEqual(["Lia"]);
    expect(only.parcels?.leftOut).toEqual(["Cartão Azul"]);
  });

  it("tells when a card's parcels end, and is null with no parcels", () => {
    const v = invoicesView(withBills(bills()));
    const azul = v.months
      .find((m) => m.key === "2026-10")
      ?.cards.find((c) => c.card === "Cartão Azul");
    expect(azul?.bank?.parcelsUntil).toBe("2027-04");
    expect(invoicesView(withBills([])).parcels).toBeNull();
  });
});

describe("months view", () => {
  it("opens on today's month and marks the closed and the coming ones", () => {
    const v = monthsView(fixture);
    expect(v.current).toBe("2026-10");
    const at = v.months.findIndex((m) => m.key === "2026-10");
    expect(v.months[at]).toMatchObject({ past: false, future: false });
    expect(v.months[at - 1]?.past).toBe(true);
    expect(v.months[at + 1]?.future).toBe(true);
  });

  it("brings the warnings about the month and the months ahead, which Hoje leaves out", () => {
    const up = { kind: "fixed-up", label: "aluguel", amount: 1_950_00, change: 50_00 } as const;
    const r = {
      ...fixture,
      projection: { ...fixture.projection, insights: [...fixture.projection.insights, up] },
    } as ProjectionResponse;
    expect(monthsView(r).warnings).toEqual([
      { kind: "month-negative", year: 2026, month: 11, amount: 58028, share: 77 },
      up,
    ]);
  });

  it("leaves out the performance of months without lines", () => {
    const empty = {
      ...fixture,
      projection: {
        ...fixture.projection,
        months: fixture.projection.months.map((m) => ({ ...m, entrada: 0, saida: 0, diario: 0 })),
      },
    } as ProjectionResponse;
    expect(monthsView(empty).months.every((m) => m.result === null)).toBe(true);
    expect(monthsView(fixture).months.some((m) => m.result !== null)).toBe(true);
  });
});

describe("months termômetro", () => {
  it("brings each month's days and the next payday's saving", () => {
    const v = monthsView(fixture);
    const now = v.months.find((m) => m.key === v.current);
    expect(now?.days).toEqual(
      fixture.projection.months.find((m) => m.year === now?.year && m.month === now?.month)?.days,
    );
    expect(now?.days.length).toBeGreaterThan(0);
    expect(v.saving).toEqual(fixture.projection.saving);
  });
});

describe("simulate view", () => {
  it("answers as the site's simulator does", () => {
    const cs = fixture.projection.canSpend;
    if (!cs) throw new Error("fixture has a usual card");
    expect(simulateView(fixture, 600_00 as never, 3)).toMatchObject(
      simulateInstallments(cs, fixture.projection.months, 600_00 as never, 3),
    );
  });

  it("still sends the old amount per day, which Android 0.73 and older cannot read without", () => {
    // (R$ 2.945,00 − R$ 732,20 − R$ 200,00 of the first parcel) over the 27 days left.
    expect(simulateView(fixture, 600_00 as never, 3)?.cycle.perDay).toBe(7454);
  });

  it("has nothing to simulate without a usual card", () => {
    const none = { ...fixture, projection: { ...fixture.projection, canSpend: null } };
    expect(simulateView(none, 100_00 as never, 1)).toBeNull();
  });
});

describe("scenario view", () => {
  it("is the sheet as it is with no pace and no change, from today on", () => {
    const r = scenarioView(fixture, null, { pace: "planilha", changes: [] });
    expect(r.days[0]?.date).toBe(fixture.projection.today);
    expect(r.days.every((d) => d.sim === d.sheet)).toBe(true);
  });

  it("puts a purchase's first parcel on the usual card's next bill", () => {
    const usual = fixture.projection.cards.find((c) => c.usual);
    if (!usual) throw new Error("fixture has a usual card");
    const r = scenarioView(fixture, null, {
      pace: "planilha",
      changes: [{ kind: "compra", amount: 300_00 as never, count: 1 }],
    });
    const due = r.days.find((d) => d.date === usual.cycle.due);
    expect(due && due.sheet - due.sim).toBe(300_00);
  });

  it("starts at the ceiling when there is one, else on the sheet, and never on a pace it lacks", () => {
    expect(scenarioView(fixture, null, { changes: [] }).pace).toBe("planilha");
    expect(scenarioView(fixture, 3_000_00 as never, { changes: [] }).pace).toBe("teto");
    expect(scenarioView(fixture, null, { pace: "teto", changes: [] }).pace).toBe("planilha");
    expect(scenarioView(fixture, 3_000_00 as never, { pace: "media", changes: [] }).pace).toBe(
      "media",
    );
  });

  it("answers every pace at once, the one it opens on first, so a chip never waits", () => {
    const changes = [
      {
        kind: "saida" as const,
        amount: 100_00 as never,
        date: fixture.projection.today as never,
        months: 1,
      },
    ];
    const all = scenarioViews(fixture, 3_000_00 as never, changes);
    expect(all.map((v) => v.pace)).toEqual(["teto", "planilha", "media"]);
    expect(all[0]).toEqual(scenarioView(fixture, 3_000_00 as never, { changes }));
    expect(all[2]).toEqual(scenarioView(fixture, 3_000_00 as never, { pace: "media", changes }));
    expect(scenarioViews(fixture, null, []).map((v) => v.pace)).toEqual(["planilha", "media"]);
  });

  it("tells the screen the sheet's last day, the usual card and the paces it allows", () => {
    const r = scenarioView(fixture, null, { changes: [] });
    expect(r.today).toBe(fixture.projection.today);
    expect(r.readAt).toBe(fixture.sheet.readAt);
    expect(r.end).toBe(r.days.at(-1)?.date);
    expect(r.end).toBe("2026-12-31");
    expect(r.card).toBe("Cartão Azul");
    expect(r.due).toBe(fixture.projection.cards.find((c) => c.usual)?.cycle.due);
    expect(r.paces).toEqual(["planilha", "media"]);
    expect(scenarioView(fixture, 3_000_00 as never, { changes: [] }).paces).toEqual([
      "planilha",
      "teto",
      "media",
    ]);
    expect(r.canSpend).toEqual({
      mode: fixture.projection.canSpend?.mode,
      left: fixture.projection.canSpend?.left,
      overBy: fixture.projection.canSpend?.overBy,
      due: fixture.projection.canSpend?.due,
    });
  });

  it("leaves out a change the engine refuses, names its place, and answers with the others", () => {
    const today = fixture.projection.today;
    const r = scenarioView(fixture, null, {
      pace: "planilha",
      changes: [
        { kind: "saida", amount: 100_00 as never, date: today as never, months: 1 },
        { kind: "saida", amount: 100_00 as never, date: "2000-01-01" as never, months: 1 },
      ],
    });
    expect(r.refused).toEqual([1]);
    expect(r.effects).toHaveLength(1);
    expect(scenarioView(fixture, null, { changes: [] }).refused).toEqual([]);
  });

  it("tells where the pace starts to count: next month, never on the sheet as it is", () => {
    const today = fixture.projection.today;
    expect(scenarioView(fixture, null, { pace: "planilha", changes: [] }).paceFrom).toBeNull();
    const from = scenarioView(fixture, 3_000_00 as never, { pace: "teto", changes: [] }).paceFrom;
    expect(from?.endsWith("-01")).toBe(true);
    expect(from && from > today).toBe(true);
    expect(from?.slice(0, 7)).not.toBe(today.slice(0, 7));
  });

  it("tells what each pace spends a month, so the screen can say which one is the cautious one", () => {
    const p = fixture.projection;
    const media = paceMonthly("media", p.months, p.today, null);
    expect(scenarioView(fixture, null, { changes: [] }).spends).toEqual({ teto: null, media });
    expect(scenarioView(fixture, 3_000_00 as never, { changes: [] }).spends).toEqual({
      teto: 3_000_00,
      media,
    });
  });

  it("holds the ceiling back from next month on", () => {
    const r = scenarioView(fixture, 1_000_000_00 as never, { pace: "teto", changes: [] });
    expect(r.monthly).toBe(1_000_000_00);
    expect(r.months[0]?.endSim).toBe(r.months[0]?.endSheet);
    expect(r.months.slice(1).every((m) => m.endSim < m.endSheet)).toBe(true);
  });
});

describe("ajustes view", () => {
  it("brings the settings, the sheet's cards and the diário in use", () => {
    const settings = UserSettings.parse({ othersCards: ["Cartão Verde"] });
    const v = ajustesView(fixture, settings);
    expect(v.settings).toBe(settings);
    expect(v.cards.map((c) => c.name)).toEqual(["Cartão Azul", "Cartão Verde"]);
    expect(v.dailyAuto).toBe(fixture.projection.dailyForecast);
  });
});

describe("screen routes", () => {
  const env = { ALLOWED_EMAILS: "dono@example.com", SESSION_SECRET: "test-secret" } as Env;
  it.each([
    "/api/invoices",
    "/api/months",
    "/api/ajustes",
    "/api/simulate?amount=100&count=1",
    "/api/history",
    "/api/sessions",
  ])("keeps %s behind a session", async (path) => {
    const res = await worker.fetch(
      new Request(`https://neko.test${path}`) as never,
      env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(401);
  });
});

/**
 * The Android app parses these files in its unit tests, so both sides agree on field names.
 * UPDATE_CONTRACT=1 rewrites them after an intended change to a view.
 */
describe("android screen contracts", () => {
  const settings = UserSettings.parse({ othersCards: ["Cartão Verde"], dailyForecast: 150_00 });
  it.each([
    ["invoices.json", invoicesView(fixture)],
    ["months.json", monthsView(fixture)],
    ["ajustes.json", ajustesView(fixture, settings)],
    ["simulate.json", simulateView(fixture, 600_00 as never, 3)],
    [
      "scenario.json",
      scenarioView(fixture, 3_000_00 as never, {
        changes: [
          { kind: "compra", amount: 600_00 as never, count: 3 },
          { kind: "saida", amount: 1_500_00 as never, date: "2026-10-20" as never, months: 2 },
        ],
      }),
    ],
  ])("%s matches what the Worker sends for the e2e fixture", (file, view) => {
    const path = join(import.meta.dirname, "../../android/app/src/test/resources", file);
    if (process.env.UPDATE_CONTRACT) writeFileSync(path, `${JSON.stringify(view, null, 2)}\n`);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(view);
  });
});
