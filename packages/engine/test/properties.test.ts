import { describe, expect, it } from "vitest";
import {
  add,
  addDays,
  cents,
  checkBalances,
  cycleContaining,
  diffDays,
  localDate,
  MAX_INSTALLMENTS,
  sheetHealth,
  splitInstallments,
} from "../src/index.ts";
import { cell, type DaySpec, item, ledger } from "./builders.ts";

/** Small seeded generator (mulberry32): the same cases on every run, many more than by hand. */
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const RUNS = 300;

describe("properties", () => {
  it("parcels always add up to the price, differ by cents at most and never go negative", () => {
    const r = rng(1);
    for (let i = 0; i < RUNS; i++) {
      const amount = cents(Math.floor(r() * 5_000_000));
      const count = 1 + Math.floor(r() * MAX_INSTALLMENTS);
      const parcels = splitInstallments(amount, count);
      expect(parcels).toHaveLength(count);
      expect(add(...parcels)).toBe(amount);
      expect(Math.max(...parcels) - Math.min(...parcels)).toBeLessThan(count);
      expect(Math.min(...parcels)).toBeGreaterThanOrEqual(0);
    }
  });

  it("a sheet that follows saldo = anterior + entrada − (saída + diário) is always healthy", () => {
    const r = rng(2);
    for (let i = 0; i < 60; i++) {
      const start = addDays(localDate("2025-01-01"), Math.floor(r() * 600));
      const specs: Record<string, DaySpec> = {};
      for (let d = 0; d < 40; d++) {
        if (r() < 0.6) continue;
        const a = Math.floor(r() * 300_00);
        const b = Math.floor(r() * 300_00);
        specs[addDays(start, d)] = {
          entrada: cell(a + b, [item(a, "A", null), item(b, "B", null)]),
          saida: cell(Math.floor(r() * 500_00)),
          diario: cell(Math.floor(r() * 80_00)),
        };
      }
      const l = ledger(start, 40, Math.floor(r() * 10_000_00) - 2_000_00, specs);
      expect(sheetHealth(l)).toEqual([]);
      for (const c of checkBalances(l)) expect(c.computed).toBe(c.row.saldo);
    }
  });

  it("every purchase lands on exactly one bill, closed on or after the purchase", () => {
    const r = rng(3);
    for (let i = 0; i < RUNS; i++) {
      const dueDay = 1 + Math.floor(r() * 28);
      const closingDay = 1 + Math.floor(r() * 28);
      if (closingDay === dueDay) continue;
      const card = { name: "X", dueDay, closingDay, closingEstimated: false };
      const date = addDays(localDate("2025-01-01"), Math.floor(r() * 900));
      const c = cycleContaining(card, date);
      expect(diffDays(c.start, date)).toBeGreaterThan(0);
      expect(diffDays(date, c.closing)).toBeGreaterThanOrEqual(0);
      expect(diffDays(c.closing, c.due)).toBeGreaterThan(0);
      // The next day either stays on this bill or opens the next one, never an earlier one.
      const next = cycleContaining(card, addDays(date, 1));
      expect(next.due >= c.due).toBe(true);
    }
  });
});
