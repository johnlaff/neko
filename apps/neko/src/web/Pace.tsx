import type { CanSpend, Cents } from "@neko/engine";

/**
 * A purchase's own figure in Simular: what still fits, as on the dial, or by how much the plan (or
 * the cards' ceiling) is passed. Before a value is typed it speaks for things as they are, which
 * may already be over; after, for what is left once the purchase is made. Never an amount per day.
 */
export const simFigure = (
  cs: Pick<CanSpend, "mode" | "left" | "overBy">,
  cycle: { remaining: Cents } | null,
): { label: string; amount: Cents; over: boolean } => {
  const past = cs.mode === "cards" ? "Passa do teto" : "Passa do plano";
  if (cycle === null)
    return cs.overBy > 0
      ? { label: past, amount: cs.overBy, over: true }
      : { label: "Ainda cabem", amount: cs.left, over: false };
  return cycle.remaining < 0
    ? { label: past, amount: -cycle.remaining as Cents, over: true }
    : { label: "Ainda cabem", amount: cycle.remaining, over: false };
};
