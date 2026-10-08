import type { CardConfig, Cents, Habit, Projection } from "@neko/engine";
import { z } from "zod";

/** Shared by the Worker and the web app; no runtime-specific types here. */

export type DailySource = "settings" | "sheet-note" | "inferred";

/**
 * The diário forecast and where it came from. Without a setting, the method's rule applies: use
 * the real average when it is higher than the plan, never a lower number that paints things green.
 */
export interface DailyForecast {
  readonly value: number;
  readonly source: DailySource;
  /** "previsão do diário" note found in the sheet, with the month it sits in. */
  readonly sheetNote: { readonly perDay: number; readonly date: string } | null;
  /** Average daily card + diário spending over the last 3 full months. */
  readonly inferred: number;
}

export interface ProjectionResponse {
  readonly projection: Projection;
  readonly daily: DailyForecast;
  readonly cardsKnown: readonly CardConfig[];
  readonly sheet: {
    readonly id: string;
    readonly version: string;
    readonly modifiedTime: string;
    readonly readAt: string;
    /** Tab title → gid, for links straight to a cell. */
    readonly tabs: Record<string, number>;
  };
  /**
   * Days the sheet changed, as a streak. Attached fresh on every read, never cached with the
   * projection; absent from copies saved before it existed.
   */
  readonly habit?: Habit;
}

export interface HistoryPoint {
  readonly at: string;
  readonly today: string;
  readonly monthEndProjected: Cents;
}

export interface HistoryResponse {
  readonly points: readonly HistoryPoint[];
  /** Last minus first month-end projection; null with fewer than two readings. */
  readonly delta: Cents | null;
}

const CentsSchema = z.number().int().nonnegative();

export const UserSettings = z.object({
  /** Planned diário per day, in cents. Null: the sheet's diário plan note, then the past average. */
  dailyForecast: CentsSchema.nullable().default(null),
  usualCard: z.string().min(1).nullable().default(null),
  cycleBudget: CentsSchema.nullable().default(null),
  cards: z
    .array(
      z.object({
        name: z.string().min(1),
        closingDay: z.number().int().min(1).max(31),
        dueDay: z.number().int().min(1).max(31),
      }),
    )
    .default([]),
  /** Cards someone else pays (e.g. a partner's), left out of your spending pace. */
  othersCards: z.array(z.string().min(1)).default([]),
  /** Conferência points already checked (see `issueKey`), hidden from Hoje. */
  reviewed: z.array(z.string().min(1).max(120)).max(300).default([]),
});
export type UserSettings = z.infer<typeof UserSettings>;
