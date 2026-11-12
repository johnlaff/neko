import type {
  BankMovement,
  BillCheck,
  CardConfig,
  Cents,
  DailySuggestion,
  Habit,
  OwnerMark,
  PhoneTrust,
  Projection,
  RefValue,
  SaldoCheck,
  Subscription,
  TransferDue,
  WeekSpend,
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
  /** Cards and Pix of the last whole week and the one before, for Sunday's summary; absent without a bank. */
  readonly week?: WeekSpend | null;
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
export interface IgnoredItem {
  readonly key: string;
  readonly date: string;
  /** The item's title, as Para lançar showed it. */
  readonly title: string;
}

export interface CardLimit {
  /** The sheet's card name. */
  readonly card: string;
  readonly limit: Cents;
  readonly available: Cents;
}

export interface BankView {
  /** When Meu Pluggy last read the bank read longest ago; null before the first read. */
  readonly syncedAt: string | null;
  /** Future bills of the cards tied to a sheet name, with the parcels already owed. */
  readonly checks: readonly BillCheck[];
  /** Each linked card's limit and what is free of it; absent from a Worker that predates it. */
  readonly limits?: readonly CardLimit[];
  /** Account movements with no line in the sheet, oldest first. */
  readonly missing: readonly BankMovement[];
  /** Para lançar: what the bank showed and the sheet does not have yet. */
  readonly queue?: readonly QueueItemView[];
  /** Items set aside with Ignorar, still in the bank's window: one tap brings each back. */
  readonly ignored?: readonly IgnoredItem[];
  /** Yesterday's Saldo against the accounts; null without a balance to compare. */
  readonly saldo?: SaldoCheck | null;
  /** Charges that come back each month on your cards; absent from a Worker that predates it. */
  readonly subscriptions?: SubscriptionsView;
  /** Purchases on your cards marked as someone else's; absent from a Worker that predates it. */
  readonly owners?: readonly OwnerMark[];
  /** Money to move into an account before the bank debits a bill from it; absent before. */
  readonly transfers?: readonly TransferDue[];
  /** Avisos de compra: how each bank app's reads fared against the bank; absent before. */
  readonly phone?: readonly PhoneTrust[];
}

export interface SubscriptionsView {
  /** Biggest first; `cancel` when marked to cancel. */
  readonly items: readonly (Subscription & { readonly cancel: boolean })[];
  /** One month of all of them. */
  readonly total: Cents;
  /** One month of the ones marked to cancel. */
  readonly toCancel: Cents;
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
  /** Subscriptions (see engine `subscriptions`, by key) the owner marked to cancel. */
  cancel: z.array(z.string().min(1).max(120)).max(100).default([]),
  /** Purchases on your cards that are someone else's (see engine `ownerKey`), to be paid back. */
  owners: z
    .array(z.object({ key: z.string().min(1).max(160), person: z.string().trim().min(1).max(40) }))
    .max(200)
    .default([]),
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
  /** The last fill or change of the Diário previsto and the settings before it, for Desfazer. */
  previstoUndo: z
    .object({
      entry: z.string().uuid(),
      dailyForecast: z.number().int().nonnegative().nullable(),
      since: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable(),
    })
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
      /** For an account (not a card): where its money goes, as the owner said; null unanswered. */
      readonly use: "guardado" | "corrente" | null;
    }[];
  }[];
}

/**
 * POST /api/statement: the bank's bill PDF read and kept, with the lines it added to what Open
 * Finance sent; or why it was not kept.
 */
export type StatementAnswer =
  | {
      readonly read: true;
      readonly due: string;
      readonly cards: number;
      readonly lines: number;
      readonly added: readonly {
        readonly card: string;
        readonly description: string;
        readonly amount: number;
      }[];
    }
  | {
      readonly read: false;
      /**
       * `mismatch`: a card's lines do not make the total it prints (`problems` says which);
       * `unreadable`: no read came out (a password or a damaged file); `account`: no linked card
       * account has these card numbers; `paused`: the month's AI budget is spent.
       */
      readonly reason: "mismatch" | "unreadable" | "account" | "paused";
      readonly problems?: readonly {
        readonly card: string | null;
        readonly printed: number;
        readonly read: number;
      }[];
      readonly pausedUntil?: string;
    };

/** GET /api/mia: whether Mia is on and how much of the month's cap is spent. */
export interface MiaStatus {
  readonly ligada: boolean;
  /** Whole percent of the monthly cap. */
  readonly usadoPct: number;
  /** `AAAA-MM-DD` Mia comes back, when the cap was reached. */
  readonly pausadaAte: string | null;
  /** 2 when her agent answers (POST /api/mia2); absent or 1 for the first Mia. */
  readonly versao?: 1 | 2;
}

/** POST /api/mia2: a question, in the conversation `sessao` when there is one. */
export interface Mia2Ask {
  readonly pergunta: string;
  readonly sessao?: string | undefined;
}

/** A money value of Mia 2's text, as written, and whether it came from the Neko. */
export interface Mia2Valor {
  readonly conferido: boolean;
  /** The screen it was read from, to lead back to it. */
  readonly tela?: "hoje" | "faturas" | "mes" | "simular" | undefined;
  /** `AAAA-MM`, on Mês. */
  readonly mes?: string | undefined;
}

/** A chart Mia draws in the conversation, values in reais, one label per value. */
export interface Mia2Grafico {
  readonly titulo: string;
  readonly tipo: "linha" | "barras";
  readonly rotulos: readonly string[];
  readonly series: readonly { readonly nome: string; readonly valores: readonly number[] }[];
  readonly nota?: string | undefined;
}

/**
 * One line of POST /api/mia2's answer (NDJSON), in the order things happen. The text of a message
 * comes first in pieces (`parcial`, each the whole text so far), then whole (`mensagem`), with its
 * money values checked.
 */
export type Mia2Line =
  | { readonly t: "sessao"; readonly id: string }
  | { readonly t: "status"; readonly texto: string }
  | { readonly t: "parcial"; readonly id: string; readonly texto: string }
  | {
      readonly t: "mensagem";
      readonly id: string;
      readonly texto: string;
      /** Keyed by the value exactly as it appears in `texto` (`R$ 1.234,56`). */
      readonly valores: Readonly<Record<string, Mia2Valor>>;
    }
  | { readonly t: "grafico"; readonly id: string; readonly grafico: Mia2Grafico }
  /** A number did not check: what this question showed so far gives way to a new answer. */
  | { readonly t: "refazendo" }
  | { readonly t: "fim" }
  | { readonly t: "erro"; readonly motivo: "limite_mes" | "limite_conversa" | "falha" };

/** One answer from POST /api/mia: `{{vN}}` in the text, each one's value beside it. */
export interface MiaReply {
  readonly texto: string;
  readonly valores: Readonly<Record<string, RefValue>>;
  readonly modelo: string | null;
}
