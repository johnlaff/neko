/**
 * What Neko counts of its own use, so what to keep or cut is decided with data: each screen opened
 * and the few buttons whose future is in question, by name only. Never an amount, a name or a date from
 * the sheet. The order is the summary's in Ajustes; the Android app sends the same keys.
 */
export const USAGE_SCREENS = {
  hoje: "Hoje",
  faturas: "Faturas",
  mes: "Mês",
  ajustes: "Ajustes",
  mia: "Mia",
} as const;

export const USAGE_TAPS = {
  lancar: "Lançar",
  simular: "Simular compra",
  calculo: "Como calculei",
  ler: "Ler a planilha de novo",
} as const;

export const USAGE = { ...USAGE_SCREENS, ...USAGE_TAPS } as const;

export type UsageEvent = keyof typeof USAGE;
export const USAGE_APPS = ["web", "android"] as const;
export type UsageApp = (typeof USAGE_APPS)[number];

/** Ajustes › Uso do Neko: the last 30 days. */
export interface UsageSummary {
  readonly window: number;
  /** Days Neko was opened at all, and on each app. */
  readonly days: number;
  readonly android: number;
  readonly web: number;
  /** Every screen, then every button, in USAGE order; the ones never used with zero. */
  readonly screens: readonly UsageCount[];
  readonly taps: readonly UsageCount[];
}

export interface UsageCount {
  readonly event: UsageEvent;
  readonly label: string;
  readonly count: number;
}
