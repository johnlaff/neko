import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  cents,
  inferCards,
  isCardItem,
  localDate,
  mergeCards,
  normalizeName,
  project,
} from "@neko/engine";
import { type ApiSpreadsheet, readSpreadsheet } from "@neko/sheet-reader";
import { describe, expect, it } from "vitest";
import { ajustesView, invoicesView, monthsView } from "../src/shared/screens.ts";
import { todayView } from "../src/shared/today.ts";
import { UserSettings } from "../src/shared/types.ts";
import { buildResponse } from "../src/worker/pipeline.ts";

/**
 * The real sheet as Sheets returned it, read as the Worker reads it: Neko must agree with the
 * sheet everywhere. The copy holds the owner's finances, so it lives outside the repository;
 * point NEKO_REAL_SHEET at it to run this. CI covers the same paths with invented ledgers.
 */
const path = process.env.NEKO_REAL_SHEET ?? "";
const available = path !== "" && existsSync(path);

const read = () => {
  const doc = JSON.parse(readFileSync(path, "utf8")) as ApiSpreadsheet;
  const today = localDate(process.env.NEKO_REAL_TODAY ?? "2026-10-05");
  const { ledger } = readSpreadsheet(doc);
  const projection = project(ledger, today, {
    dailyForecast: cents(0),
    usualCard: null,
    cycleBudget: null,
    cards: mergeCards(inferCards(ledger), []),
    othersCards: [],
  });
  return { today, ledger, projection };
};

describe.runIf(available)("the real sheet", () => {
  const { today, ledger, projection } = available ? read() : ({} as ReturnType<typeof read>);
  it("reads both year tabs, one row per day", () => {
    expect(ledger).toHaveLength(365 + 365);
    expect(ledger[0]?.date).toBe("2025-01-01");
    expect(ledger.at(-1)?.date).toBe("2026-12-31");
  });
  it("has no health issues: every note adds up and every saldo follows the chain", () => {
    expect(projection.health).toEqual([]);
  });
  it("shows today's balance and every month end exactly as the sheet has them", () => {
    const saldo = (d: string) => ledger.find((r) => r.date === d)?.saldo;
    expect(projection.balanceToday).toBe(saldo(today));
    for (const m of projection.months) {
      const key = `${m.year}-${String(m.month).padStart(2, "0")}`;
      const lastDay = ledger.filter((r) => r.date.startsWith(key)).at(-1);
      expect(m.endSheet, key).toBe(lastDay?.saldo);
    }
  });
  it("knows the cards behind the bills", () => {
    expect(projection.cards.length).toBeGreaterThanOrEqual(2);
  });
  it("shows every day's balance and moves exactly as the cells have them", () => {
    const byDate = new Map(ledger.map((r) => [r.date, r]));
    for (const m of projection.months) {
      const key = `${m.year}-${String(m.month).padStart(2, "0")}`;
      const rows = ledger.filter((r) => r.date.startsWith(key));
      const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0);
      expect([m.entrada, m.saida, m.diario], key).toEqual([
        sum((r) => r.entrada.amount),
        sum((r) => r.saida.amount),
        sum((r) => r.diario.amount),
      ]);
      for (const d of m.days) {
        const date = `${key}-${String(d.day).padStart(2, "0")}`;
        const row = byDate.get(date);
        expect(d.balance, date).toBe(row?.saldo);
        const moved = (income: boolean) =>
          d.moves.filter((v) => (v.kind === "income") === income).reduce((a, v) => a + v.amount, 0);
        expect([moved(true), moved(false)], date).toEqual([
          row?.entrada.amount,
          (row?.saida.amount ?? 0) + (row?.diario.amount ?? 0),
        ]);
      }
    }
  });
  it("puts each card's due day where its latest bill sits", () => {
    for (const c of projection.cards) {
      const name = normalizeName(c.card.name);
      const last = ledger
        .filter((r) =>
          r.saida.items.some((i) => isCardItem(i) && normalizeName(i.description) === name),
        )
        .at(-1);
      expect(last && Number(last.date.slice(8)), c.card.name).toBe(c.card.dueDay);
    }
  });
});

/**
 * Writes what the Android app would receive for the real sheet into NEKO_ANDROID_VIEWS (a private
 * folder outside the repository), so its screenshot test can draw the real screens: long card
 * names and many cards show layout problems the invented fixture never has. NEKO_REAL_SETTINGS
 * may point at the settings JSON to apply.
 */
const viewsOut = process.env.NEKO_ANDROID_VIEWS ?? "";
describe.runIf(available && viewsOut !== "")("android views of the real sheet", () => {
  it("writes today, invoices, months and ajustes", () => {
    const doc = JSON.parse(readFileSync(path, "utf8")) as ApiSpreadsheet;
    const today = localDate(process.env.NEKO_REAL_TODAY ?? "2026-10-05");
    const settingsPath = process.env.NEKO_REAL_SETTINGS ?? "";
    const settings = UserSettings.parse(
      settingsPath ? JSON.parse(readFileSync(settingsPath, "utf8")) : {},
    );
    const r = buildResponse(doc, today, settings, {
      id: "planilha-real",
      version: "1",
      modifiedTime: `${today}T11:00:00.000Z`,
      readAt: `${today}T11:00:00.000Z`,
      tabs: { "2025": 1, "2026": 2 },
    });
    mkdirSync(viewsOut, { recursive: true });
    const write = (file: string, v: unknown) =>
      writeFileSync(join(viewsOut, file), `${JSON.stringify(v, null, 2)}\n`);
    write("today.json", todayView(r, settings.reviewed));
    write("invoices.json", invoicesView(r));
    write("months.json", monthsView(r));
    write("ajustes.json", ajustesView(r, settings));
    expect(r.projection.cards.length).toBeGreaterThan(0);
  });
});
