import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ajustesView, invoicesView, monthsView } from "../src/shared/screens.ts";
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
  it("shows the usual bill with its history, the open one last", () => {
    const v = invoicesView(fixture);
    expect(v.usual).toMatchObject({ card: "Cartão Azul", onSheet: 3_600_31 });
    expect(v.history).toHaveLength(7);
    expect(v.history.at(-1)).toEqual({ due: v.usual?.due, amount: 3_600_31, open: true });
    expect(v.history.slice(0, -1).every((b) => !b.open)).toBe(true);
    expect(v.openVsAverage).toBe(fixture.projection.openVsAverage);
  });

  it("lists other people's and other cards apart from the usual one", () => {
    const v = invoicesView(fixture);
    expect(v.others).toEqual([
      expect.objectContaining({ card: "Cartão Verde", others: true, onSheet: 527_70 }),
    ]);
    // With a single card of your own there is nothing to pick from.
    expect(v.buyToday).toEqual([]);
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
    expect(v.empty).toEqual(["Vazio"]);
  });

  it("says when the sheet has no card", () => {
    const v = invoicesView(withCards([]));
    expect(v).toMatchObject({ hasCards: false, usual: null, history: [], buyToday: [] });
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
  it.each(["/api/invoices", "/api/months", "/api/ajustes"])(
    "keeps %s behind a session",
    async (path) => {
      const res = await worker.fetch(
        new Request(`https://neko.test${path}`) as never,
        env,
        {} as ExecutionContext,
      );
      expect(res.status).toBe(401);
    },
  );
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
  ])("%s matches what the Worker sends for the e2e fixture", (file, view) => {
    const path = join(import.meta.dirname, "../../android/app/src/test/resources", file);
    if (process.env.UPDATE_CONTRACT) writeFileSync(path, `${JSON.stringify(view, null, 2)}\n`);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(view);
  });
});
