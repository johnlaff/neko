import { describe, expect, it } from "vitest";
import { cents, type MonthView, type Outflow, outflowTrend } from "../src/index.ts";

const line = (label: string, amount: number): Outflow => ({
  label,
  amount: cents(amount),
  count: 1,
  kind: "bill",
  change: null,
  countBefore: null,
  others: false,
});
const month = (year: number, m: number, outflows: Outflow[]) =>
  ({ year, month: m, outflows }) as unknown as MonthView;

describe("outflowTrend: one destination across the months before the one on screen", () => {
  const months = [
    month(2026, 3, [line("Aluguel", 1900_00)]),
    month(2026, 4, [line("Aluguel", 1900_00), line("Carro 3/36", 800_00)]),
    month(2026, 5, [line("aluguél", 1950_00), line("Carro 4/36", 800_00)]),
    month(2026, 6, []),
    month(2026, 7, [line("Aluguel", 1950_00), line("Carro 6/36", 800_00)]),
    month(2026, 8, [line("Aluguel", 1950_00), line("Carro 7/36", 800_00)]),
    month(2026, 9, [line("Aluguel", 2000_00), line("Carro 8/36", 800_00)]),
  ];

  it("reads the last 6 months up to the one asked, oldest first, ignoring case and accents", () => {
    expect(outflowTrend(months, 2026, 9, "Aluguel")).toEqual([
      { year: 2026, month: 4, amount: 1900_00 },
      { year: 2026, month: 5, amount: 1950_00 },
      { year: 2026, month: 6, amount: 0 },
      { year: 2026, month: 7, amount: 1950_00 },
      { year: 2026, month: 8, amount: 1950_00 },
      { year: 2026, month: 9, amount: 2000_00 },
    ]);
  });

  it("follows an installment from one part to the next", () => {
    const carro = outflowTrend(months, 2026, 9, "Carro 8/36").map((p) => p.amount);
    expect(carro).toEqual([800_00, 800_00, 0, 800_00, 800_00, 800_00]);
  });

  it("keeps only the months the sheet has, and never looks past the month asked", () => {
    expect(outflowTrend(months, 2026, 4, "Aluguel")).toEqual([
      { year: 2026, month: 3, amount: 1900_00 },
      { year: 2026, month: 4, amount: 1900_00 },
    ]);
  });
});
