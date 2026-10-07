import { existsSync, readFileSync } from "node:fs";
import { cents, inferCards, localDate, mergeCards, project } from "@neko/engine";
import { type ApiSpreadsheet, readSpreadsheet } from "@neko/sheet-reader";
import { describe, expect, it } from "vitest";

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
});
