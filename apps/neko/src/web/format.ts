import { valuesHidden } from "./privacy.ts";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
/** Shown in place of every amount while values are hidden. */
export const HIDDEN_MONEY = "R$ ••••";

/**
 * Typographic minus (−) instead of a hyphen, matching the explicit signs in lists. While values
 * are hidden every amount reads the same, so nothing leaks through its length.
 */
export const money = (cents: number) =>
  valuesHidden() ? HIDDEN_MONEY : brl.format(cents / 100).replace("-", "−");

const MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];
export const monthName = (m: number) => MONTHS[m - 1] ?? "";

/** `2026-10-13` → `13 out`. */
export const shortDate = (iso: string) =>
  `${Number(iso.slice(8, 10))} ${monthName(Number(iso.slice(5, 7))).slice(0, 3)}`;

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
export const weekday = (iso: string) => WEEKDAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()] ?? "";

export const days = (n: number) => (n === 1 ? "1 dia" : `${n} dias`);

export { sheetCellUrl } from "../shared/sheet.ts";

const LONG_WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const dayIndex = (iso: string) => Date.parse(`${iso}T12:00:00Z`) / 86_400_000;

/** `Hoje`, `Amanhã` or `Quinta, 9 out`, relative to the sheet's today. */
export const relativeDay = (iso: string, today: string) => {
  const diff = Math.round(dayIndex(iso) - dayIndex(today));
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Amanhã";
  const name = LONG_WEEKDAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()] ?? "";
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}, ${shortDate(iso)}`;
};

/** Parses a typed amount like `1.234,56` into cents; null when empty or invalid. */
export const toCents = (s: string): number | null => {
  const t = s.trim().replace(/\./g, "").replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};

/** `outubro` → `Outubro`: every label starts with a capital letter. */
export const capitalize = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

/** A signed amount for ledgers: `+R$ 10,00`, `−R$ 10,00`, and no sign at zero. */
export const signed = (cents: number, sign: "+" | "−") =>
  cents === 0 ? money(0) : `${sign}${money(Math.abs(cents))}`;

const SP_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });
const SP_TIME = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
});
/** When the sheet was read, in the same date style as the rest of the app: `4 out, 21:11`. */
export const readAtLabel = (iso: string) => {
  const d = new Date(iso);
  return `${shortDate(SP_DAY.format(d))}, ${SP_TIME.format(d)}`;
};
