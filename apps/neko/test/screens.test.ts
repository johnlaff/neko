import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { simulateInstallments } from "@neko/engine";
import { describe, expect, it } from "vitest";
import { ajustesView, invoicesView, monthsView, simulateView } from "../src/shared/screens.ts";
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
        card("Gio", { others: true, payInDays: 60 }),
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

describe("months view", () => {
  it("opens on today's month and marks the closed and the coming ones", () => {
    const v = monthsView(fixture);
    expect(v.current).toBe("2026-10");
    const at = v.months.findIndex((m) => m.key === "2026-10");
    expect(v.months[at]).toMatchObject({ past: false, future: false });
    expect(v.months[at - 1]?.past).toBe(true);
    expect(v.months[at + 1]?.future).toBe(true);
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
    expect(simulateView(fixture, 600_00 as never, 3)).toEqual(
      simulateInstallments(cs, fixture.projection.months, 600_00 as never, 3),
    );
  });

  it("has nothing to simulate without a usual card", () => {
    const none = { ...fixture, projection: { ...fixture.projection, canSpend: null } };
    expect(simulateView(none, 100_00 as never, 1)).toBeNull();
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
  ])("%s matches what the Worker sends for the e2e fixture", (file, view) => {
    const path = join(import.meta.dirname, "../../android/app/src/test/resources", file);
    if (process.env.UPDATE_CONTRACT) writeFileSync(path, `${JSON.stringify(view, null, 2)}\n`);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(view);
  });
});
