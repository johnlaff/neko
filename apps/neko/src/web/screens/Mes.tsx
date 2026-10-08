import type { Fixed, MonthView, Outflow } from "@neko/engine";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useRef } from "react";
import { api } from "../api.ts";
import { BigMoney, Columns, ItemName } from "../Figures.tsx";
import { capitalize, money, monthName, shortDate, signed } from "../format.ts";
import { IconCard, IconChevron, IconChevronLeft, IconReceipt, IconRepeat } from "../icons.tsx";
import { Thermo } from "../Thermo.tsx";
import { WithProjection } from "../useProjection.tsx";

const key = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;

/** How the current month's end moved since the first reading of the month, under the figure. */
const Evolution = () => {
  const history = useQuery({ queryKey: ["history"], queryFn: api.history });
  const first = history.data?.points[0];
  const delta = history.data?.delta ?? null;
  if (!first || delta === null) return null;
  const since = `desde ${shortDate(first.today)}`;
  return (
    <p className={`delta${delta > 0 ? " pos" : delta < 0 ? " neg" : ""}`}>
      {delta === 0 ? (
        `Igual ${since}`
      ) : (
        <>
          <span aria-hidden="true">{delta > 0 ? "▲" : "▼"}</span>
          <span className="sr-only">{delta > 0 ? "Melhorou" : "Piorou"}</span>{" "}
          {money(Math.abs(delta))} <span className="muted">{since}</span>
        </>
      )}
    </p>
  );
};

/** Lines shown before "Ver todas". */
const OUTFLOWS_SHOWN = 5;

const OutflowRows = ({ items, top }: { items: readonly Outflow[]; top: number }) => (
  <ul className="rows lead outflows">
    {items.map((o) => (
      <li key={o.label}>
        <span className="avatar" aria-hidden="true">
          {o.kind === "card" ? <IconCard /> : <IconReceipt />}
        </span>
        <span className="name">
          <ItemName text={o.label} />
          {o.others && <span className="chip">De outra pessoa</span>}
          {/* Display only: the bar is the line's amount scaled to the month's largest line. */}
          <span className="meter" aria-hidden="true">
            <span style={{ width: `${top <= 0 ? 0 : (o.amount / top) * 100}%` }} />
          </span>
        </span>
        <span className="value">
          {money(o.amount)}
          {o.change != null && o.change !== 0 && (
            <small className={o.change > 0 ? "neg" : undefined}>
              <span aria-hidden="true">{o.change > 0 ? "▲" : "▼"} </span>
              {money(Math.abs(o.change))}
              <span className="sr-only">
                {o.change > 0 ? " a mais" : " a menos"} que no mês anterior
              </span>
            </small>
          )}
        </span>
      </li>
    ))}
  </ul>
);

/** Where the month's Saída went, by description: the engine groups, the screen lists. */
const Outflows = ({
  items,
  before,
  half,
}: {
  items: readonly Outflow[];
  before: string;
  half: boolean;
}) => {
  const top = items[0]?.amount ?? 0;
  const shown = items.slice(0, OUTFLOWS_SHOWN);
  const rest = items.slice(OUTFLOWS_SHOWN);
  return (
    <section className={`panel${half ? " half" : ""}`}>
      <div className="panel-head">
        <h2>Para onde foi</h2>
        <span className="meta">
          {items.length === 1 ? "1 destino" : `${items.length} destinos`}
        </span>
      </div>
      <OutflowRows items={shown} top={top} />
      {rest.length > 0 && (
        <details className="formula">
          <summary>
            <IconChevron />
            Ver mais {rest.length}
          </summary>
          <OutflowRows items={rest} top={top} />
        </details>
      )}
      {items.some((o) => o.change != null && o.change !== 0) && (
        <p className="hint">
          <span aria-hidden="true">▲▼ </span>
          Comparado a {before}
        </p>
      )}
    </section>
  );
};

/** Fixed bills shown before "Ver mais". */
const FIXED_SHOWN = 4;

const FixedRows = ({ items }: { items: readonly Fixed[] }) => (
  <ul className="rows lead fixed">
    {items.map((f) => {
      const i = f.installment;
      return (
        <li key={f.label}>
          <span className="avatar" aria-hidden="true">
            {i ? <IconCard /> : <IconRepeat />}
          </span>
          <span className="name">{f.label}</span>
          <span className="value">{money(f.amount)}</span>
          {i && (
            <>
              {/* Display only: the bar is installments paid out of the total. */}
              <span className="meter" aria-hidden="true">
                <span style={{ width: `${(i.paid / i.total) * 100}%` }} />
              </span>
              <span className="meta">
                {i.paid} de {i.total}
                {i.left > 0 &&
                  ` · Faltam ${money(i.left)} até ${monthName(i.ends.month).slice(0, 3)} ${i.ends.year}`}
              </span>
            </>
          )}
        </li>
      );
    })}
  </ul>
);

/** Bills that come back every month and installments, with how far each installment has gone. */
const FixedPanel = ({
  items,
  total,
  half,
}: {
  items: readonly Fixed[];
  total: number;
  /** Side by side with "Para onde foi" on wide screens, so neither leaves a hole next to it. */
  half: boolean;
}) => {
  const rest = items.slice(FIXED_SHOWN);
  return (
    <section className={`panel${half ? " half" : ""}`}>
      <div className="panel-head">
        <h2>Fixos do mês</h2>
        <span className="meta">{money(total)}</span>
      </div>
      <FixedRows items={items.slice(0, FIXED_SHOWN)} />
      {rest.length > 0 && (
        <details className="formula">
          <summary>
            <IconChevron />
            Ver mais {rest.length}
          </summary>
          <FixedRows items={rest} />
        </details>
      )}
    </section>
  );
};

export const Mes = () => {
  // The month on screen lives in the URL: a warning can link to it and reload keeps it.
  const picked = useSearch({ from: "/mes" }).m ?? null;
  const navigate = useNavigate({ from: "/mes" });
  const setPicked = (m: string | null) =>
    navigate({ search: m ? { m } : {}, replace: true, viewTransition: false });
  // A sideways swipe on the month's card turns the month, like the arrows above it.
  const touch = useRef<{ x: number; y: number } | null>(null);
  return (
    <WithProjection>
      {({ projection: p }) => {
        const nowKey = p.today.slice(0, 7);
        const keys = p.months.map((m) => key(m.year, m.month));
        const nowIdx = keys.indexOf(nowKey);
        const at = picked === null ? -1 : keys.indexOf(picked);
        const idx = at >= 0 ? at : Math.max(nowIdx, 0);
        const m = p.months[idx];
        if (!m) return <p className="muted">A planilha não tem meses para mostrar.</p>;
        const name = monthName(m.month);
        const past = idx < nowIdx;
        const year = p.months.filter((x) => x.year === m.year);
        // A projection cached offline by an older version has no outflows yet.
        const outflows = m.outflows ?? [];
        const fixed = m.fixed ?? [];
        // The method's performance: did the month make or lose money. Missing on old caches,
        // and meaningless on months the sheet has no lines for.
        const moved = (x: MonthView) => x.entrada !== 0 || x.saida !== 0 || x.diario !== 0;
        const result = moved(m) ? (m.result ?? null) : null;
        // Saída under an "Investimento:" header; missing on caches from before it existed.
        const saved = m.saved ?? 0;
        return (
          <>
            <div className="month-nav">
              <button
                type="button"
                className="icon"
                onClick={() => setPicked(keys[idx - 1] ?? null)}
                disabled={idx === 0}
                aria-label="Mês anterior"
              >
                <IconChevronLeft />
              </button>
              <h1 aria-live="polite">
                {capitalize(name)} {m.year}
              </h1>
              <button
                type="button"
                className="icon"
                onClick={() => setPicked(keys[idx + 1] ?? null)}
                disabled={idx === p.months.length - 1}
                aria-label="Próximo mês"
              >
                <IconChevron />
              </button>
            </div>

            <section
              className="panel hero"
              onTouchStart={(e) => {
                const t = e.touches[0];
                touch.current = t ? { x: t.clientX, y: t.clientY } : null;
              }}
              onTouchEnd={(e) => {
                const start = touch.current;
                const t = e.changedTouches[0];
                touch.current = null;
                if (!start || !t) return;
                const dx = t.clientX - start.x;
                if (Math.abs(dx) < 56 || Math.abs(dx) < 2 * Math.abs(t.clientY - start.y)) return;
                const to = keys[dx < 0 ? idx + 1 : idx - 1];
                if (to) setPicked(to);
              }}
            >
              <div className="panel-head">
                <h2>{past ? "Terminou com" : "Termina com"}</h2>
                <span className="chip plain">{past ? "Fechado" : "Previsão"}</span>
              </div>
              <div className="figure-stack">
                <BigMoney cents={m.endSheet} tone={m.endSheet < 0 ? "neg" : "plain"} />
                {idx === nowIdx && <Evolution />}
              </div>
              <Columns
                label={`Saldo no fim de cada mês de ${m.year}`}
                selected={key(m.year, m.month)}
                onSelect={setPicked}
                items={year.map((x) => {
                  const k = key(x.year, x.month);
                  return {
                    key: k,
                    label: capitalize(monthName(x.month).charAt(0)),
                    value: x.endSheet,
                    description: `${capitalize(monthName(x.month))}: ${money(x.endSheet)}`,
                    tone: k === key(m.year, m.month) ? "accent" : k > nowKey ? "faint" : undefined,
                  };
                })}
              />
              {result !== null && (
                <p className="figure-line performance">
                  <span className="muted">
                    {result < 0 ? "Prejuízo" : "Lucro"} {past ? "do mês" : "previsto"}
                  </span>
                  <strong className={result > 0 ? "pos" : result < 0 ? "neg" : undefined}>
                    {money(Math.abs(result))}
                  </strong>
                </p>
              )}
              {saved > 0 && (
                <p className="figure-line">
                  <span className="muted">
                    Guardado
                    {m.savedShare !== null && ` · ${m.savedShare}% das entradas`}
                  </span>
                  <strong>{money(saved)}</strong>
                </p>
              )}
              <details className="formula">
                <summary>
                  <IconChevron />
                  Ver extrato
                </summary>
                <dl className="ledger">
                  <dt>Começou com</dt>
                  <dd>{money(m.startBalance)}</dd>
                  <dt>Entradas</dt>
                  <dd className="pos">{signed(m.entrada, "+")}</dd>
                  <dt>Saídas</dt>
                  <dd>{signed(m.saida, "−")}</dd>
                  {/* Zero when the diário goes on the card: it is in the bills, under Saídas. */}
                  {m.diario !== 0 && (
                    <>
                      <dt>Diário</dt>
                      <dd>{signed(m.diario, "−")}</dd>
                    </>
                  )}
                  <dt className="total">{past ? "Terminou com" : "Termina com"}</dt>
                  <dd className={`total${m.endSheet < 0 ? " neg" : ""}`}>{money(m.endSheet)}</dd>
                </dl>
                {result !== null && (
                  <p>
                    {result < 0 ? "Prejuízo" : "Lucro"} é quanto o saldo{" "}
                    {result < 0 ? "desceu" : "subiu"} no mês. Dinheiro guardado também sai da conta,
                    então um mês em que você economizou pode aparecer como prejuízo.
                  </p>
                )}
                {saved > 0 && (
                  <>
                    <dl className="ledger">
                      <dt className="total">Custo de vida</dt>
                      <dd className="total">{money(m.livingCost)}</dd>
                    </dl>
                    <p>
                      Custo de vida é o que saiu sem contar o que foi guardado. É a base da reserva
                      de emergência, que o método pede de 6 a 12 vezes maior.
                    </p>
                  </>
                )}
              </details>
            </section>

            {(m.days ?? []).length > 0 && (
              <Thermo
                key={key(m.year, m.month)}
                days={m.days}
                year={m.year}
                month={m.month}
                today={p.today}
                saving={p.saving}
              />
            )}

            {outflows.length > 0 && (
              <Outflows
                items={outflows}
                half={fixed.length > 0}
                before={monthName(m.month === 1 ? 12 : m.month - 1)}
              />
            )}

            {fixed.length > 0 && (
              <FixedPanel items={fixed} total={m.fixedTotal ?? 0} half={outflows.length > 0} />
            )}
          </>
        );
      }}
    </WithProjection>
  );
};
