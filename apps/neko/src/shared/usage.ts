/**
 * What Neko counts of its own use, so what to keep or cut is decided with data: each screen opened,
 * the few buttons whose future is in question and the taps on each notification, by name only. Never an amount, a name or a date from
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
  simular: "Simular",
  calculo: "Como calculei",
  ler: "Ler a planilha de novo",
} as const;

/** Taps on each kind of notification (worker/push.ts tags), to see which ones earn their place. */
export const USAGE_NOTICES = {
  notificacao_manha: "Contas e teto",
  notificacao_noite: "Lançar o dia",
  notificacao_aviso: "Avisos",
  notificacao_mia: "Resumos da Mia",
} as const;

/** The notification's tag to what its tap counts as: named after the Android channels. */
export const NOTICE_TAP = {
  morning: "notificacao_manha",
  ceiling: "notificacao_manha",
  evening: "notificacao_noite",
  alert: "notificacao_aviso",
  mia: "notificacao_mia",
  subscription: "notificacao_manha",
} as const satisfies Record<string, keyof typeof USAGE_NOTICES>;

export const USAGE = { ...USAGE_SCREENS, ...USAGE_TAPS, ...USAGE_NOTICES } as const;

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
  /** Every screen, then every button, then every notification, in USAGE order; the ones never used with zero. */
  readonly screens: readonly UsageCount[];
  readonly taps: readonly UsageCount[];
  readonly notices: readonly UsageCount[];
}

export interface UsageCount {
  readonly event: UsageEvent;
  readonly label: string;
  readonly count: number;
}
