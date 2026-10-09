import { type CardConfig, cycleContaining, cycleForDueMonth, normalizeName } from "./cards.ts";
import { type LocalDate, parts } from "./date.ts";
import { MAX_INSTALLMENTS, splitInstallments } from "./installments.ts";
import type { Column } from "./ledger.ts";
import type { Cents } from "./money.ts";

/**
 * What the owner says happened, in the words of the method (specs/005-lancamentos):
 * - `entrada`: money in (salary, yields, a reimbursement), on the day it lands.
 * - `diario`: Pix, debit or cash, which leaves the account that day.
 * - `conta`: a fixed bill paid from the account.
 * - `investimento`: money put in an investment that is not the reserve, like a pension.
 * - `reserva`: money moved to the emergency reserve (the only lines counted as savings).
 * - `cartao`: a credit card purchase, which only touches the account on the bill's due date.
 */
export type EntryKind = "entrada" | "diario" | "conta" | "investimento" | "reserva" | "cartao";

export interface EntryInput {
  readonly kind: EntryKind;
  readonly amount: Cents;
  readonly description: string;
  /** Day of the movement; for a card, the purchase date. */
  readonly date: LocalDate;
  /** Card name as configured, required for `cartao`. */
  readonly card?: string;
  /** Number of parcels, only for `cartao`. */
  readonly installments?: number;
}

/**
 * One change to one cell. `target: "line"` adds a note line; `target: "card"` adds to the card's
 * line on the bill (one line per card, decided in specs/005), creating it when missing.
 */
export interface Placement {
  readonly date: LocalDate;
  readonly column: Column;
  /** Normalized note section (`contas`, `cartoes`, `investimento`, `reserva`), null for none. */
  readonly section: string | null;
  readonly amount: Cents;
  readonly description: string;
  readonly target: "line" | "card";
}

export class EntryError extends Error {
  override name = "EntryError";
}

const SINGLE: Record<Exclude<EntryKind, "cartao">, Pick<Placement, "column" | "section">> = {
  entrada: { column: "entrada", section: null },
  diario: { column: "diario", section: null },
  conta: { column: "saida", section: "contas" },
  investimento: { column: "saida", section: "investimento" },
  reserva: { column: "saida", section: "reserva" },
};

/**
 * Where an entry goes in the sheet. Card purchases follow the method: they raise the bill on the
 * due date of the cycle they fall in, never the Diário, and each parcel raises a later bill.
 */
export const placeEntry = (entry: EntryInput, cards: readonly CardConfig[]): Placement[] => {
  if (!Number.isSafeInteger(entry.amount) || entry.amount <= 0)
    throw new EntryError("o valor precisa ser maior que zero");
  const description = entry.description.replace(/\s+/g, " ").trim();
  if (description === "") throw new EntryError("falta a descrição");
  const installments = entry.installments ?? 1;

  if (entry.kind !== "cartao") {
    if (installments !== 1) throw new EntryError("só compra no cartão tem parcelas");
    return [
      {
        date: entry.date,
        ...SINGLE[entry.kind],
        amount: entry.amount,
        description,
        target: "line",
      },
    ];
  }

  if (!entry.card) throw new EntryError("escolha o cartão");
  const key = normalizeName(entry.card);
  const card = cards.find((c) => normalizeName(c.name) === key);
  if (!card) throw new EntryError(`cartão ${entry.card} não está configurado`);
  if (card.closingEstimated)
    throw new EntryError(`configure o dia de fechamento do ${card.name} antes de lançar nele`);
  if (!Number.isInteger(installments) || installments < 1 || installments > MAX_INSTALLMENTS)
    throw new EntryError(`parcelas vão de 1 a ${MAX_INSTALLMENTS}`);

  const first = parts(cycleContaining(card, entry.date).due);
  return splitInstallments(entry.amount, installments).map((amount, i) => ({
    date: cycleForDueMonth(card, first.year, first.month + i).due,
    column: "saida",
    section: "cartoes",
    amount,
    description: card.name,
    target: "card",
  }));
};
