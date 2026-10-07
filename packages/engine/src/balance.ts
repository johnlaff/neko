import type { DayRow, Ledger } from "./ledger.ts";
import { add, type Cents, sub } from "./money.ts";

/** saldo = saldo do dia anterior + entrada − (saída + diário), the method's only balance rule. */
export const nextBalance = (previous: Cents, row: Pick<DayRow, "entrada" | "saida" | "diario">) =>
  sub(add(previous, row.entrada.amount), add(row.saida.amount, row.diario.amount));

export interface BalanceCheck {
  readonly row: DayRow;
  readonly computed: Cents;
}

/**
 * Recomputes the balance chain from the first row's own opening balance. Whenever the sheet
 * disagrees, the check reports it and re-anchors on the sheet value, so one wrong cell is
 * reported once instead of cascading through every later day.
 */
export const checkBalances = (ledger: Ledger): BalanceCheck[] => {
  const first = ledger[0];
  if (!first || first.saldo === null) return [];
  let previous = sub(
    first.saldo,
    sub(first.entrada.amount, add(first.saida.amount, first.diario.amount)),
  );
  const out: BalanceCheck[] = [];
  for (const row of ledger) {
    const computed = nextBalance(previous, row);
    out.push({ row, computed });
    previous = row.saldo ?? computed;
  }
  return out;
};
