import { type CanSpend, type Cents, type MonthView, simulateInstallments } from "@neko/engine";
import { useId, useState } from "react";
import { used } from "./api.ts";
import { money, monthName, shortDate, toCents } from "./format.ts";

/** Common purchase sizes, one tap away. */
const PRESETS = [50, 100, 250, 500] as const;
/** How Brazilian stores usually split a card purchase. */
const PARCELS = [1, 2, 3, 6, 10, 12] as const;

const capital = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
const monthLabel = (year: number, month: number) =>
  `${capital(monthName(month)).slice(0, 3)} ${String(year).slice(2)}`;

/**
 * The simulator's first figure: what still fits, as on the dial, or by how much the plan (or the
 * cards' ceiling) is passed. Before a value is typed it speaks for things as they are, which may
 * already be over; after, for what is left once the purchase is made. Never an amount per day.
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

export const Simulator = ({ cs, months }: { cs: CanSpend; months: readonly MonthView[] }) => {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [count, setCount] = useState(1);
  const amount = toCents(typed);
  const sim =
    amount && amount > 0 ? simulateInstallments(cs, months, amount as Cents, count) : null;
  const cycle = sim?.cycle ?? null;
  const fig = simFigure(cs, cycle);
  const parcel = sim?.parcels[0];
  const last = sim?.parcels.at(-1)?.due;
  const red = sim?.firstNegative ?? null;
  return (
    <>
      <button
        type="button"
        className="ghost"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => {
          if (!open) used("simular");
          setOpen(!open);
        }}
      >
        Simular compra
      </button>
      {open && (
        <section id={`${id}-panel`} className="panel sim">
          <label className="field" htmlFor={id}>
            Valor da compra no {cs.card}
          </label>
          <span className="affix big">
            <span aria-hidden="true">R$</span>
            <input
              id={id}
              inputMode="decimal"
              autoComplete="off"
              // biome-ignore lint/a11y/noAutofocus: the field is the only thing this toggle opens
              autoFocus
              placeholder="0,00"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </span>
          <div className="presets">
            {PRESETS.map((v) => (
              <button
                key={v}
                type="button"
                className="chip-button"
                aria-pressed={typed === `${v},00`}
                onClick={() => setTyped(`${v},00`)}
              >
                {v}
              </button>
            ))}
          </div>
          <span className="field" id={`${id}-parcels`}>
            Parcelas
          </span>
          <fieldset className="parcels" aria-labelledby={`${id}-parcels`}>
            {PARCELS.map((n) => (
              <button
                key={n}
                type="button"
                className="chip-button"
                aria-pressed={count === n}
                onClick={() => setCount(n)}
              >
                {n === 1 ? "À vista" : `${n}×`}
              </button>
            ))}
          </fieldset>
          <dl className="figures" aria-live="polite">
            <div>
              <dt>{fig.label}</dt>
              <dd className={fig.over ? "neg" : undefined}>{money(fig.amount)}</dd>
            </div>
            {sim && count > 1 && parcel ? (
              <div className="end">
                <dt>{count}× de</dt>
                <dd>{money(parcel.amount)}</dd>
              </div>
            ) : (
              <div className="end">
                <dt>Sai da conta</dt>
                <dd>{shortDate(cycle?.due ?? cs.due)}</dd>
              </div>
            )}
          </dl>
          {sim && (red || sim.lowest || count > 1) && (
            <p className="sim-outlook" aria-live="polite">
              {red ? (
                <span className="bad">
                  {red.date
                    ? `Fica no vermelho em ${shortDate(red.date)}: ${money(red.end)}`
                    : `${capital(monthName(red.month))} termina no vermelho: ${money(red.end)}`}
                </span>
              ) : (
                sim.lowest && (
                  <span>
                    {sim.lowest.date
                      ? `Menor saldo: ${shortDate(sim.lowest.date)}, ${money(sim.lowest.end)}`
                      : `Menor fim de mês: ${monthLabel(sim.lowest.year, sim.lowest.month)}, ${money(sim.lowest.end)}`}
                  </span>
                )
              )}
              {count > 1 && last && (
                <span>
                  Última parcela em {shortDate(last)} de {last.slice(0, 4)}
                </span>
              )}
            </p>
          )}
        </section>
      )}
    </>
  );
};
