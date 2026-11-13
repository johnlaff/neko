import { clampedDay, parts } from "./date.ts";
import { splitInstallments } from "./installments.ts";
import { add, type Cents } from "./money.ts";
import { type Simulation, simulatePurchase } from "./projection.ts";
import { ownCardBills, type Saving } from "./savings.ts";
import {
  type Change,
  type Pace,
  type ScenarioInput,
  type ScenarioPoint,
  simulate,
} from "./scenario.ts";

/**
 * "Posso comprar?": one purchase checked against the owner's own rules, the month's ceiling
 * (Ajustes › Teto do mês, cards and Pix) and a balance that never goes below zero, the method's
 * "não comprometer o fluxo de caixa" (faq/credito-para-debito). It reads Simular with and without
 * the purchase, at the ceiling when there is one; nothing is saved.
 */
export interface PurchaseAsk {
  /** The whole purchase; on a card, split into `count` parcels from the usual card's next bill. */
  readonly amount: Cents;
  readonly count: number;
  /** `pix`: today, all at once, Pix or debit. */
  readonly via: "cartao" | "pix";
  /** How many months the thing lasts, when said or guessed; 0 for what is used up at once. */
  readonly lifeMonths?: number | undefined;
}

/** Fits, fits but leaves a month or the balance with no room, or does not fit. */
export type Verdict = "cabe" | "aperta" | "nao_cabe";

/**
 * `teto`: past what is left of this month's ceiling. `negativo`: the balance goes below zero
 * where, or earlier than, it would without it. `meses`: a later parcel's month has bills that
 * reach the ceiling. `duracao`: the parcels outlast the thing; the method splits only what lasts,
 * and not past it ("é um negócio durável?", aulas/01-aprofundamento-do-metodo, "à vista ou
 * parcelado", [10:35] and [12:04]). `ja_negativo`: the balance goes below zero without it too.
 */
export type PurchaseReason = "teto" | "negativo" | "meses" | "duracao" | "ja_negativo";

export interface PurchaseCheck {
  readonly verdict: Verdict;
  /** Why, worst first; empty when it fits. */
  readonly reasons: readonly PurchaseReason[];
  readonly pace: Pace;
  /** This month's ceiling after it; null without one or when no parcel lands in it. */
  readonly now: Simulation | null;
  /** Where the money leaves: each parcel's bill, or today for a Pix. */
  readonly parcels: readonly { readonly date: string; readonly amount: Cents }[];
  /** Later parcels' months whose own card bills, the parcel included, reach the ceiling. */
  readonly tight: readonly { readonly month: string; readonly bills: Cents }[];
  readonly lowest: Pair<ScenarioPoint>;
  readonly firstNegative: Pair<ScenarioPoint>;
  /** What the next payday lets you set aside, as Hoje's "Dia de guardar" reads it. */
  readonly saving: Pair<Saving>;
}

interface Pair<T> {
  readonly with: T | null;
  readonly without: T | null;
}

export const checkPurchase = (input: ScenarioInput, ask: PurchaseAsk): PurchaseCheck => {
  if (ask.via === "pix" && ask.count !== 1) throw new RangeError("a Pix is paid at once");
  const change: Change =
    ask.via === "pix"
      ? { kind: "saida", amount: ask.amount, date: input.today, months: 1 }
      : { kind: "compra", amount: ask.amount, count: ask.count };
  const pace: Pace = input.ceiling === null ? "planilha" : "teto";
  const yes = simulate(input, { pace, changes: [change] });
  const no = simulate(input, { pace, changes: [] });

  const due = input.due === null ? null : parts(input.due);
  const parcels =
    ask.via === "pix" || due === null
      ? [{ date: input.today, amount: ask.amount }]
      : splitInstallments(ask.amount, ask.count).map((amount, k) => ({
          date: clampedDay(due.year, due.month + k, due.day),
          amount,
        }));
  const first = parcels[0] ?? { date: input.today, amount: ask.amount };
  // The ceiling measures one month of spending: next month's bills and this month's Pix, or the
  // usual card's cycle. A first parcel on a bill it does not measure is left to the months check.
  const cs = input.canSpend ?? null;
  const counts =
    cs !== null &&
    (ask.via === "pix" ? cs.mode !== "cycle" : first.date.slice(0, 7) === cs.due.slice(0, 7));
  const now = counts ? simulatePurchase(cs, first.amount) : null;

  const later = ask.via === "pix" ? [] : parcels.slice(now ? 1 : 0);
  const bills = ownCardBills(input.months);
  const tight = later.flatMap((p) => {
    const month = p.date.slice(0, 7);
    const bill = bills.find((b) => b.month === month);
    return bill && yes.full.includes(month) ? [{ month, bills: add(bill.amount, p.amount) }] : [];
  });
  const red = yes.firstNegative;
  const wasRed = no.firstNegative;

  const reasons: PurchaseReason[] = [];
  if (now && now.remaining < 0) reasons.push("teto");
  if (red && (wasRed === null || red.date < wasRed.date)) reasons.push("negativo");
  if (tight.length > 0) reasons.push("meses");
  if (ask.lifeMonths !== undefined && parcels.length > Math.max(1, ask.lifeMonths))
    reasons.push("duracao");
  if (red && wasRed && red.date >= wasRed.date) reasons.push("ja_negativo");
  const verdict: Verdict =
    reasons.includes("teto") || reasons.includes("negativo")
      ? "nao_cabe"
      : reasons.length > 0
        ? "aperta"
        : "cabe";

  return {
    verdict,
    reasons,
    pace,
    now,
    parcels,
    tight,
    lowest: { with: yes.lowest, without: no.lowest },
    firstNegative: { with: red, without: wasRed },
    saving: { with: yes.saving, without: no.saving },
  };
};
