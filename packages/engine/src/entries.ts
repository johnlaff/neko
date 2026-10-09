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
 * - `resgate`: money back from the reserve, an Entrada under `Reserva:`.
 * - `saida`: any other money out, a plain Saída line (a difference the bank shows, say).
 * - `cartao`: a credit card purchase, which only touches the account on the bill's due date.
 */
export type EntryKind =
  | "entrada"
  | "diario"
  | "conta"
  | "investimento"
  | "reserva"
  | "resgate"
  | "saida"
  | "cartao";

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
 * line on the bill (one line per card, decided in specs/005), creating it when missing;
 * `target: "economia"` changes the month's cell in the Economia tab, the method's own record of
 * what was kept: `amount` is added for `column: "saida"` (money put away) and taken off for
 * `column: "entrada"` (a resgate), as `=500+500-300`. Its `date` is the month's first day.
 *
 * With `was`, the change is to something already there instead of an addition: the line
 * `description` worth `was` becomes worth `amount`, and goes away when `amount` is 0. On a card
 * line `was` is what the line holds now (0 for no line), and `amount` its new total. Moving a line
 * is two placements: away from one day, onto another.
 */
export interface Placement {
  readonly date: LocalDate;
  readonly column: Column;
  /** Normalized note section (`contas`, `cartoes`, `investimento`, `reserva`), null for none. */
  readonly section: string | null;
  readonly amount: Cents;
  readonly description: string;
  readonly target: "line" | "card" | "economia";
  readonly was?: Cents;
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
  resgate: { column: "entrada", section: "reserva" },
  saida: { column: "saida", section: null },
};

const isReserve = (p: Placement) =>
  p.target === "line" && (p.section?.startsWith("reserva") ?? false) && p.column !== "diario";

/**
 * The Economia cells that follow the reserve lines among `placements`: one per month, by the net
 * change of what was kept (saved minus drawn back), after the line placements.
 */
export const withEconomia = (placements: readonly Placement[]): Placement[] => {
  const net = new Map<string, number>();
  for (const p of placements.filter(isReserve)) {
    const month = `${p.date.slice(0, 7)}-01`;
    const change = (p.amount - (p.was ?? 0)) * (p.column === "saida" ? 1 : -1);
    net.set(month, (net.get(month) ?? 0) + change);
  }
  return [
    ...placements,
    ...[...net]
      .filter(([, n]) => n !== 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([month, n]): Placement => ({
          date: month as LocalDate,
          column: n > 0 ? "saida" : "entrada",
          section: null,
          amount: Math.abs(n) as Cents,
          description: "Economia",
          target: "economia",
        }),
      ),
  ];
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
    return withEconomia([
      {
        date: entry.date,
        ...SINGLE[entry.kind],
        amount: entry.amount,
        description,
        target: "line",
      },
    ]);
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
