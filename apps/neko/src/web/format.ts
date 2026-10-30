import type { SaldoWaiting } from "@neko/engine";
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

/**
 * Under the Saldo, the planned lines the bank has not moved yet: "Aulas Inglês (R$ 232,00, 29
 * out) ainda não saiu do banco." The Android app (Format.waitingText) says it the same way.
 */
export const waitingText = (waiting: readonly SaldoWaiting[]) => {
  const names = waiting.map((w) => `${w.description} (${money(w.amount)}, ${shortDate(w.date)})`);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} e ${names.at(-1)}` : names[0];
  const out = waiting.every((w) => w.column === "saida");
  const into = waiting.every((w) => w.column === "entrada");
  const verb =
    waiting.length === 1
      ? out
        ? "saiu do"
        : "entrou no"
      : out
        ? "saíram do"
        : into
          ? "entraram no"
          : "passaram pelo";
  return `${list ?? ""} ainda não ${verb} banco.`;
};

/** Joining words that stay lowercase inside a name. */
const SMALL_WORDS = new Set("a as o os e de da das do dos em na no para".split(" "));

/**
 * A bank's description as people write it: banks send "PIX FEIRA DO BAIRRO" in capitals, read as
 * "Pix Feira do Bairro". Text that already has lowercase, and words with digits, stay as sent.
 */
export const bankText = (text: string) => {
  if (/\p{Ll}/u.test(text)) return text;
  return text
    .split(" ")
    .map((word, i) => {
      if (/\d/.test(word)) return word;
      const lower = word.toLocaleLowerCase("pt-BR");
      if (i > 0 && SMALL_WORDS.has(lower)) return lower;
      return lower.charAt(0).toLocaleUpperCase("pt-BR") + lower.slice(1);
    })
    .join(" ");
};

/** The usual card's closing, from `closesInDays`, which counts today: 1 is today, 2 tomorrow. */
export const closesIn = (closesInDays: number) =>
  closesInDays <= 1
    ? "Fecha hoje"
    : closesInDays === 2
      ? "Fecha amanhã"
      : `Fecha em ${days(closesInDays - 1)}`;

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

/**
 * Who sold it, as a bank app shows a card line: one space between words, and without the payment
 * company the charge went through ("DL *UberRides", "MP*MERCADOLIVRE", "PAYPAL *NETFLIX").
 */
const ACQUIRER = /^(dl|pg|pag|pags|mp|ifd|ec|pp|paypal|sumup|zp|ebn|ebanx)\s*\*\s*/i;
export const merchantName = (text: string) => {
  const spaced = text.replace(/\s+/g, " ").trim();
  return spaced.replace(ACQUIRER, "") || spaced;
};

/** The bank writes the parcel into the text too ("LOJA PARC 03/06"); the line already says it. */
export const bankLineName = (l: { description: string; installment: number | null }) =>
  bankText(
    merchantName(
      l.installment === null
        ? l.description
        : l.description.replace(/\s*(parc(ela)?\.?\s*)?\d{1,2}\s*\/\s*\d{1,2}\s*$/i, ""),
    ),
  );
