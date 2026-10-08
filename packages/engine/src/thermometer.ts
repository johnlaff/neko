import type { Cents } from "./money.ts";

/**
 * The method's "termômetro": each day's balance in the color the sheet paints it. Default bands
 * from the course (breno, c:42456356): below zero red, 0–999 yellow, 1.000–1.999 light green,
 * 2.000 and up dark green.
 */
export type Band = "negative" | "attention" | "healthy" | "surplus";

export const thermometer = (balance: Cents): Band =>
  balance < 0
    ? "negative"
    : balance < 1_000_00
      ? "attention"
      : balance < 2_000_00
        ? "healthy"
        : "surplus";

/**
 * One thing that moved a day's balance, as the sheet has it; an empty description is a cell
 * amount without a note line.
 */
export interface DayMove {
  readonly kind: "income" | "bill" | "card" | "diario";
  readonly description: string;
  readonly amount: Cents;
}

export interface ThermoDay {
  readonly day: number;
  /** Balance at the end of the day, as the sheet has it. */
  readonly balance: Cents;
  readonly band: Band;
  /** After today: a forecast, not what happened. */
  readonly future: boolean;
  /** What moved the balance that day, in sheet order: Entrada, Saída, Diário. */
  readonly moves: readonly DayMove[];
}
