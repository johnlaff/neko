import type { BankLineView, InvoiceRow } from "../../shared/screens.ts";
import { capitalize, closesIn, monthName, shortDate } from "../format.ts";

export const monthOf = (key: string) => monthName(Number(key.slice(5, 7)));
export const shortMonth = (key: string) => capitalize(monthOf(key).slice(0, 3));
const dayIndex = (iso: string) => Date.parse(`${iso}T12:00:00Z`) / 86_400_000;

/** `2027-06` → `jun/27`, the way a bill says when a plan ends. */
export const monthYear = (key: string) => `${monthOf(key).slice(0, 3)}/${key.slice(2, 4)}`;

/** `vence hoje`, `vence amanhã`, `vence 12 nov`. */
export const dueText = (due: string, today: string) => {
  const d = Math.round(dayIndex(due) - dayIndex(today));
  // Non-breaking: a wrap falls at the "·", never inside the date.
  return (d === 0 ? "vence hoje" : d === 1 ? "vence amanhã" : `vence ${shortDate(due)}`).replaceAll(
    " ",
    " ",
  );
};

const billState = (c: InvoiceRow, today: string) => {
  if (c.state === "due") return `Venceu ${shortDate(c.due)}`;
  const due = dueText(c.due, today);
  if (c.state === "closed" || c.bank?.closed) return `Fechada · ${due}`;
  if (c.state === "future") return capitalize(due);
  const open = c.bank?.onlyParcels
    ? "Só parcelas por enquanto"
    : `${closesIn(c.closesInDays)}${c.closingEstimated ? " (estimado)" : ""}`;
  return `${open} · ${due}`;
};

/** Where the bill stands, in one line: the row's only words besides its name. */
export const stateLine = (c: InvoiceRow, today: string) => {
  const who = c.owner
    ? `De ${c.owner} · `
    : c.others
      ? "De outra pessoa · "
      : c.reimbursed
        ? "Reembolsada · "
        : "";
  return who + billState(c, today);
};

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

/** A purchase's day on its bill: `Hoje`, `Ontem, 19 nov`, `Segunda, 17 nov`. */
export const buyDay = (date: string, today: string) => {
  const d = Math.round(dayIndex(today) - dayIndex(date));
  if (d === 0) return "Hoje";
  if (d === 1) return `Ontem, ${shortDate(date)}`;
  return `${WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()] ?? ""}, ${shortDate(date)}`;
};

export const isParcel = (l: Pick<BankLineView, "installments">) => (l.installments ?? 1) > 1;

/** `4 de 10 · acaba em jun/27`, or `10 de 10 · última`. */
export const parcelText = (
  l: Pick<BankLineView, "installment" | "installments" | "endsIn">,
): string | null => {
  if (l.installment === null || l.installments === null || l.installments <= 1) return null;
  const of = `${l.installment} de ${l.installments}`;
  if (l.installment >= l.installments) return `${of} · última`;
  return l.endsIn ? `${of} · acaba em ${monthYear(l.endsIn)}` : of;
};

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** `junho`, or `junho de 2027` outside today's year. */
export const monthLong = (key: string, today: string) =>
  key.slice(0, 4) === today.slice(0, 4) ? monthOf(key) : `${monthOf(key)} de ${key.slice(0, 4)}`;

/** `2026-11` plus `n` months. */
export const monthAfter = (key: string, n: number) => {
  const at = Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1 + n;
  return `${Math.floor(at / 12)}-${String((at % 12) + 1).padStart(2, "0")}`;
};
