/**
 * What Neko counts of its own use (the verdict of 2026-10-23, item 4): each screen opened and the
 * few buttons whose future is in question, by name only. Never an amount, a name or a date from
 * the sheet. The order is the summary's in Ajustes; the Android app sends the same keys.
 */
export const USAGE = {
  hoje: "Hoje",
  faturas: "Faturas",
  mes: "Mês",
  ajustes: "Ajustes",
  mia: "Mia",
  lancar: "Lançar",
  simular: "Simular compra",
  calculo: "Como calculei",
  ler: "Ler a planilha de novo",
} as const;

export type UsageEvent = keyof typeof USAGE;
export type UsageApp = "web" | "android";

/** Ajustes › Uso do Neko: the last 30 days. */
export interface UsageSummary {
  readonly window: number;
  /** Days Neko was opened at all, and on each app. */
  readonly days: number;
  readonly android: number;
  readonly web: number;
  /** Every event in USAGE order, the ones never used with zero. */
  readonly events: readonly {
    readonly event: UsageEvent;
    readonly label: string;
    readonly count: number;
  }[];
}
