import type {
  BankMovement,
  BillCheck,
  CardConfig,
  Cents,
  DailySuggestion,
  Habit,
  Projection,
  RefValue,
  SaldoCheck,
} from "@neko/engine";
import { z } from "zod";
import type { QueueItemView } from "./queue.ts";

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
  /** Neko may write to the sheet now (specs/005-lancamentos); attached fresh, never cached. */
  readonly writing?: boolean;
  /** Bank against sheet (specs/003-open-finance); absent with no bank linked. */
  readonly bank?: BankView | null;
  /** The Diário previsto (specs/005-lancamentos, Fase 3); absent from older copies. */
  readonly previsto?: PrevistoView;
}

/** The Diário previsto: on or off, its value, and what the bank says a day costs. */
export interface PrevistoView {
  readonly on: boolean;
  /** Value per day; with it off, the Diário Neko uses for the pace. */
  readonly value: number;
  /** When the value was approved; the review comes 3 months later. */
  readonly since: string | null;
  /** From the bank: what a usual day costs. Null with no bank, or too little of it. */
  readonly suggestion: DailySuggestion | null;
  /** Every 3 months while on: the real cost of a day since `from`, beside the value. */
  readonly review: { readonly real: number; readonly from: string } | null;
  /** The last year tab: the forecast fills the days up to its December. */
  readonly lastYear: number;
}

/** Only divergences: the bank never changes a balance, a bill or the projection. */
export interface BankView {
  /** Last time any linked bank was read; null before the first read. */
  readonly syncedAt: string | null;
  /** Future bills of the cards tied to a sheet name, with the parcels already owed. */
  readonly checks: readonly BillCheck[];
  /** Account movements with no line in the sheet, oldest first. */
  readonly missing: readonly BankMovement[];
  /** Para lançar: what the bank showed and the sheet does not have yet. */
  readonly queue?: readonly QueueItemView[];
  /** Yesterday's Saldo against the accounts; null without a balance to compare. */
  readonly saldo?: SaldoCheck | null;
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
  /** Each bank card to its name in the sheet; a null number covers the whole card account. */
  bankCards: z
    .array(
      z.object({
        accountId: z.string().min(1).max(64),
        cardNumber: z
          .string()
          .regex(/^\d{4}$/)
          .nullable(),
        card: z.string().min(1).max(60),
      }),
    )
    .max(20)
    .default([]),
  /** Conferência points already checked (see `issueKey`), hidden from Hoje. */
  reviewed: z.array(z.string().min(1).max(120)).max(300).default([]),
  /** Off: Neko writes nothing to the sheet, whatever is tapped (specs/005-lancamentos). */
  writing: z.boolean().default(true),
  /** What each linked account is, as the owner answered: where savings go, or day to day. */
  accountUse: z.record(z.string().min(1).max(64), z.enum(["guardado", "corrente"])).default({}),
  /** Origins (bank text, see `originKey`) the owner launched as savings: proposed so next time. */
  savedOrigins: z.array(z.string().min(1).max(80)).max(100).default([]),
  /**
   * The Diário previsto (specs/005-lancamentos, Fase 3): the day the owner approved its value,
   * `dailyForecast`, written on the days ahead; null while it is off.
   */
  previstoSince: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
});
export type UserSettings = z.infer<typeof UserSettings>;

/** Ajustes › Bancos: the linked banks, what each one has, and how its cards map to the sheet. */
export interface BanksResponse {
  /** False until the Pluggy keys are set on the Worker. */
  readonly configured: boolean;
  readonly cards: UserSettings["bankCards"];
  readonly items: readonly {
    readonly itemId: string;
    readonly label: string;
    readonly syncedAt: string | null;
    readonly error: string | null;
    readonly accounts: readonly {
      readonly id: string;
      readonly name: string;
      readonly card: boolean;
      readonly last4: string | null;
      readonly balance: Cents;
      /** Last four digits of each physical card seen on this card account. */
      readonly cardNumbers: readonly string[];
    }[];
  }[];
}

/** GET /api/mia: whether Mia is on and how much of the month's cap is spent. */
export interface MiaStatus {
  readonly ligada: boolean;
  /** Whole percent of the monthly cap. */
  readonly usadoPct: number;
  /** `AAAA-MM-DD` Mia comes back, when the cap was reached. */
  readonly pausadaAte: string | null;
}

/** One answer from POST /api/mia: `{{vN}}` in the text, each one's value beside it. */
export interface MiaReply {
  readonly texto: string;
  readonly valores: Readonly<Record<string, RefValue>>;
  readonly modelo: string | null;
}
