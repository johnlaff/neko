import { addDays, type LocalDate, localDate } from "./date.ts";
import { MAX_INSTALLMENTS } from "./installments.ts";
import { type Cents, fromReais } from "./money.ts";

/**
 * Lançar com a Mia (specs/005-lancamentos, Fase 4): a sentence becomes the fields of Lançar à mão,
 * and the owner checks them and taps Lançar as always. The model only fills a form; this decides
 * which of its fields are safe to show. A field it got wrong is left out, never guessed.
 */

/** What the model fills, by the tool's schema. Anything else is not Mia's and gives nothing. */
export const MIA_ENTRY_TYPES = ["pix", "entrada", "conta", "cartao", "nao_entendi"] as const;

export interface MiaEntry {
  readonly kind?: "diario" | "entrada" | "conta" | "cartao";
  readonly amount?: Cents;
  readonly date?: LocalDate;
  readonly description?: string;
  readonly card?: string;
  readonly installments?: number;
}

const KIND = { pix: "diario", entrada: "entrada", conta: "conta" } as const;
/** Further than this from today, a day is a misheard date, not a plan. */
const MAX_DAYS_AWAY = 366;

const day = (s: unknown, today: LocalDate): LocalDate | undefined => {
  if (typeof s !== "string") return undefined;
  try {
    const d = localDate(s);
    return d >= addDays(today, -MAX_DAYS_AWAY) && d <= addDays(today, MAX_DAYS_AWAY)
      ? d
      : undefined;
  } catch {
    return undefined;
  }
};

export const entryFromMia = (
  raw: unknown,
  today: LocalDate,
  cards: readonly string[],
): MiaEntry | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!(MIA_ENTRY_TYPES as readonly unknown[]).includes(r.tipo) || r.tipo === "nao_entendi")
    return null;
  const out: { -readonly [K in keyof MiaEntry]: MiaEntry[K] } = {};
  if (r.tipo === "cartao") {
    const said = typeof r.cartao === "string" ? r.cartao.trim().toLowerCase() : "";
    const card = cards.find((c) => c.toLowerCase() === said);
    if (card) {
      out.kind = "cartao";
      out.card = card;
      const n = r.parcelas;
      if (typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= MAX_INSTALLMENTS)
        out.installments = n;
    }
  } else out.kind = KIND[r.tipo as keyof typeof KIND];
  if (typeof r.valor === "number" && Number.isFinite(r.valor) && r.valor > 0 && r.valor < 1e8)
    out.amount = fromReais(r.valor);
  const date = day(r.dia, today);
  if (date) out.date = date;
  const name = typeof r.nome === "string" ? r.nome.trim().slice(0, 80) : "";
  if (name) out.description = name;
  return out;
};
