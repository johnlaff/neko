import { Link } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import type {
  ParcelMonthView,
  ParcelPlanView,
  ParcelSideView,
  ParcelsView,
} from "../../shared/screens.ts";
import { Board } from "../Board.tsx";
import { CategoryIcon } from "../CategoryIcon.tsx";
import { BigMoney, Columns } from "../Figures.tsx";
import { bankLineName, capitalize, money } from "../format.ts";
import { IconCheck, IconChevron } from "../icons.tsx";
import { Sheet } from "../Sheet.tsx";
import { OwnerForm } from "./Owner.tsx";
import {
  initialOf,
  monthAfter,
  monthLong,
  monthOf,
  monthYear,
  plural,
  shortMonth,
} from "./text.ts";

/** A plan's name, without the bank's "05/10". */
const planName = (p: Pick<ParcelPlanView, "description" | "installments">) =>
  bankLineName({ description: p.description, installment: p.installments });

/** `5 de 10`, or when the first parcel comes on a later bill. */
const progress = (p: ParcelPlanView) =>
  p.installment === 0 ? `1ª em ${monthYear(p.first)}` : `${p.installment} de ${p.installments}`;

/** Every month of a plan, first to last. */
const planMonths = (p: ParcelPlanView) =>
  Array.from({ length: p.installments }, (_, i) => monthAfter(p.first, i));

/** Paid, this month's and still to come, for the timeline. */
const stepOf = (p: ParcelPlanView, i: number) =>
  i < p.installment - 1 ? "paid" : i === p.installment - 1 ? "now" : undefined;

/** How much of the income and of the ceiling, when there is one to compare with. */
const Weight = ({ m }: { m: Pick<ParcelMonthView, "ofIncome" | "ofCeiling"> }) =>
  m.ofIncome === null && m.ofCeiling === null ? null : (
    <div className="chips parcel-weight">
      {m.ofIncome !== null && <span className="chip plain">{m.ofIncome}% da renda</span>}
      {m.ofCeiling !== null && <span className="chip plain">{m.ofCeiling}% do teto</span>}
    </div>
  );

/**
 * Faturas' Parcelas panel: the owner's parcels on the month's bills, their weight on the income
 * and the months ahead going down, one tap from the page with every plan.
 */
export const ParcelsPanel = ({ side, month }: { side: ParcelSideView; month: string }) => {
  const at = side.months.findIndex((m) => m.key === month);
  const shown = side.months.slice(Math.max(0, at));
  const [here] = shown;
  if (!here) return null;
  const top = Math.max(1, ...shown.map((m) => m.amount));
  return (
    <section className="panel parcels-panel">
      <div className="panel-head">
        <h2>Parcelas</h2>
        <span className="meta">{plural(here.plans, "compra", "compras")}</span>
      </div>
      <div className="figure-stack">
        <span className="muted">Nas faturas de {monthOf(here.key)}</span>
        <div className="parcel-figure">
          <BigMoney cents={here.amount} tone="plain" />
          {here.ofIncome !== null && <span className="chip plain">{here.ofIncome}% da renda</span>}
        </div>
      </div>
      <div>
        <div
          className="mini-cols"
          role="img"
          aria-label={`Parcelas de ${monthOf(here.key)} a ${monthYear(side.last)}, de ${money(here.amount)} a ${money(shown.at(-1)?.amount ?? 0)}`}
        >
          {shown.map((m) => (
            <span key={m.key} style={{ height: `${Math.max(4, (m.amount / top) * 100)}%` }} />
          ))}
        </div>
        <div className="mini-x" aria-hidden="true">
          <span>{shortMonth(here.key)}</span>
          <span>Última em {monthYear(side.last)}</span>
        </div>
      </div>
      <Link className="text-link" to="/faturas" search={{ m: month, parcelas: true }}>
        Ver todas{"\u00a0"}
        <span aria-hidden="true">›</span>
      </Link>
    </section>
  );
};

/** One dot per parcel: filled up to this month's, as `5 de 10` says beside it. */
const Dots = ({ p }: { p: ParcelPlanView }) => (
  <span className="plan-dots" aria-hidden="true">
    {planMonths(p).map((m, i) => (
      <i key={m} className={i < p.installment ? "on" : undefined} />
    ))}
  </span>
);

const PlanRow = ({
  p,
  oneCard,
  onPick,
}: {
  p: ParcelPlanView;
  /** Every plan is on the same card: the card's name would only repeat. */
  oneCard: boolean;
  onPick: () => void;
}) => {
  const meta = [
    oneCard ? null : p.card,
    p.installment < p.installments ? `falta ${money(p.left)}` : null,
  ].filter(Boolean);
  return (
    <li className="bill plan">
      <button
        type="button"
        className="row-link"
        aria-haspopup="dialog"
        aria-label={`${planName(p)}, ${money(p.part)} por mês, ${progress(p)}: abrir`}
        onClick={onPick}
      >
        <span className="avatar" aria-hidden="true">
          <CategoryIcon text={p.description} fallback={initialOf(planName(p))} />
        </span>
        <span className="name">
          {planName(p)}
          {p.installment <= 1 && <span className="chip ok">Nova</span>}
          {p.share !== null && <span className="chip plain">Dividida</span>}
        </span>
        <span className="value">
          {money(p.part)}
          <IconChevron />
        </span>
        {meta.length > 0 && <span className="meta">{capitalize(meta.join(" · "))}</span>}
        <span className="plan-progress">
          <Dots p={p} />
          <span>{progress(p)}</span>
        </span>
      </button>
    </li>
  );
};

/** One plan: its timeline, what was paid and what is left, and whose it is. */
const PlanDetail = ({
  p,
  side,
  month,
  people,
  waits,
  onDone,
}: {
  p: ParcelPlanView;
  side: string | null;
  month: string;
  people: readonly string[];
  waits: readonly string[];
  onDone: () => void;
}) => {
  const months = planMonths(p);
  const left = p.installments - Math.max(1, p.installment) + 1;
  const leftLabel =
    p.installment === 0
      ? plural(left, "parcela a pagar", "parcelas a pagar")
      : left === 1
        ? `Falta só a de ${monthOf(month)}`
        : `${left} a pagar, com a de ${monthOf(month)}`;
  return (
    <>
      <p className="muted">
        {p.card} · primeira em {monthYear(p.first)}
      </p>
      <div className="figure-stack">
        <span className="muted">{side === null ? "Por mês" : `${side} paga por mês`}</span>
        <BigMoney cents={p.part} tone="plain" />
      </div>
      <div
        className="plan-line"
        role="img"
        aria-label={`${p.installment === 0 ? "Nenhuma parcela paga" : `Parcela ${p.installment} de ${p.installments}`}, de ${monthYear(p.first)} a ${monthYear(p.last)}`}
      >
        {months.map((m, i) => (
          <span key={m} className={stepOf(p, i)}>
            <i />
            {shortMonth(m)}
          </span>
        ))}
      </div>
      <dl className="ledger">
        {p.installment > 1 && (
          <>
            <dt>{plural(p.installment - 1, "parcela paga", "parcelas pagas")}</dt>
            <dd>{money(p.paid)}</dd>
          </>
        )}
        <dt>{leftLabel}</dt>
        <dd>{money(p.left)}</dd>
        <dt>Última parcela</dt>
        <dd>{monthYear(p.last)}</dd>
      </dl>
      {p.theirCard ? (
        <p className="hint">
          {p.person && p.person !== p.card
            ? `Está no ${p.card}, e a fatura desse cartão já é toda de ${p.person}.`
            : "A fatura desse cartão já é toda de outra pessoa."}
        </p>
      ) : (
        p.key && (
          <div className="plan-owner">
            <h3>De quem é?</h3>
            <OwnerForm
              markKey={p.key}
              amount={p.amount}
              current={p.person ? { person: p.person, share: p.share } : null}
              installments={p.installments}
              due={null}
              monthly={false}
              people={people}
              waits={waits}
              onDone={onDone}
            />
          </div>
        )
      )}
      {p.installment > 0 && (
        <Link className="text-link" to="/faturas" search={{ m: month, cartao: p.card }}>
          Ver na fatura de {monthOf(month)}
          {"\u00a0"}
          <span aria-hidden="true">›</span>
        </Link>
      )}
    </>
  );
};

/** One side of the page: the owner's parcels, or one person's. */
const Side = ({
  side,
  view,
  start,
  today,
  hasPage,
  onPick,
}: {
  side: ParcelSideView;
  view: ParcelsView;
  start: string;
  today: string;
  hasPage: boolean;
  onPick: (p: ParcelPlanView) => void;
}) => {
  const { month } = view;
  // No month picked yet: the hero already says the first one, so nothing below repeats it.
  const [sel, setSel] = useState<string | null>(null);
  const pick = sel === null ? undefined : side.months.find((m) => m.key === sel);
  const own = side.person === null;
  const prev = side.previous;
  const diff = prev ? side.now - prev.amount : 0;
  const oneCard =
    new Set(
      [...side.groups.flatMap((g) => g.plans), ...(side.ended?.plans ?? [])].map((p) => p.card),
    ).size === 1;
  const short = view.short[0];
  const hero = (
    <section className="panel parcels-hero">
      <div className="figure-stack">
        <span className="muted">
          {own
            ? `Nas faturas de ${monthOf(month)}`
            : `${side.person} te paga nas faturas de ${monthOf(month)}`}
        </span>
        <BigMoney cents={side.now} tone="plain" />
        {own ? (
          <Weight m={side} />
        ) : (
          <div className="chips parcel-weight">
            <span className="chip plain">Fora da sua renda e do teto</span>
          </div>
        )}
        {prev && (
          <p className="hint">
            {diff === 0
              ? `Igual a ${monthOf(prev.month)}`
              : `${money(Math.abs(diff))} a ${diff < 0 ? "menos" : "mais"} que em ${monthOf(prev.month)}`}
          </p>
        )}
      </div>
      <dl className="ledger">
        <dt>{own ? "Falta pagar" : `Falta ${side.person} pagar`}</dt>
        <dd>{money(side.left)}</dd>
        <dt>Última parcela</dt>
        <dd>{monthYear(side.last)}</dd>
      </dl>
      {view.short.length === 0 ? (
        <p className="pos">✓ As faturas da planilha já têm essas parcelas</p>
      ) : (
        <>
          <p className="warn">
            {view.short.length === 1 && short
              ? `A planilha tem ${money(short.missing)} a menos na fatura do ${short.card} de ${monthOf(short.due.slice(0, 7))}`
              : `A planilha tem ${money(view.shortBy)} a menos em ${view.short.length} faturas`}
          </p>
          {/* Para lançar has the change: nothing is written without a tap. */}
          <Link className="text-link" to="/" hash="h-queue">
            Corrigir em Para lançar{"\u00a0"}
            <span aria-hidden="true">›</span>
          </Link>
        </>
      )}
      {view.leftOut.length > 0 && (
        <p className="hint">Sem detalhe do banco, ficam de fora: {view.leftOut.join(", ")}.</p>
      )}
      {!own && hasPage && side.person && (
        <Link className="text-link" to="/faturas" search={{ m: month, pessoa: side.person }}>
          Ver o mês de {side.person}
          {"\u00a0"}
          <span aria-hidden="true">›</span>
        </Link>
      )}
    </section>
  );
  const many = side.months.length > 12;
  const picked = pick?.key ?? start;
  // With every month alike (one plan), the columns would say nothing the hero does not.
  const months = new Set(side.months.map((m) => m.amount)).size > 1 && (
    <section className="panel">
      <div className="panel-head">
        <h2>Mês a mês</h2>
        <span className="meta">Só o que já foi comprado</span>
      </div>
      <Columns
        label="Parcelas em cada mês"
        selected={picked}
        onSelect={setSel}
        items={side.months.map((m, i) => ({
          key: m.key,
          // Past a year of months, a label every third keeps them apart.
          label: !many || i % 3 === 0 ? shortMonth(m.key) : "",
          value: m.amount,
          description: `${capitalize(monthLong(m.key, today))}: ${money(m.amount)}`,
          tone: m.key === picked ? "ink" : undefined,
        }))}
      />
      <div aria-live="polite">
        {pick && (
          <div className="parcel-pick">
            <div className="parcel-pick-top">
              <b>{capitalize(monthLong(pick.key, today))}</b>
              <span>{money(pick.amount)}</span>
            </div>
            <Weight m={pick} />
            <p className="hint">
              {pick.ending.length > 0
                ? `Última parcela neste mês: ${pick.ending.map((d) => bankLineName({ description: d, installment: 1 })).join(", ")}.`
                : "Nenhuma compra acaba neste mês."}
            </p>
          </div>
        )}
      </div>
    </section>
  );
  const list = (
    <section className="panel parcels-list">
      <div className="panel-head">
        <h2>Quando acabam</h2>
        <span className="meta">{plural(side.count, "compra", "compras")}</span>
      </div>
      {side.groups.map((g) => (
        <div key={g.last} className="day-group plan-group">
          <div className="plan-group-head">
            <h3>Última em {monthYear(g.last)}</h3>
            {/* With one plan, its own figure already says it. */}
            {g.plans.length > 1 && <span>Libera {money(g.frees)} por mês</span>}
          </div>
          <ul className="rows lead">
            {g.plans.map((p) => (
              <PlanRow
                key={`${p.card}|${p.description}|${p.first}|${p.amount}`}
                p={p}
                oneCard={oneCard}
                onPick={() => onPick(p)}
              />
            ))}
          </ul>
        </div>
      ))}
      {side.ended && (
        <div className="day-group plan-group">
          <div className="plan-group-head">
            <h3>
              {side.ended.plans.length === 1 ? "Acabou" : "Acabaram"} em{" "}
              {monthYear(side.ended.month)}
            </h3>
            {side.ended.plans.length > 1 && <span>Liberou {money(side.ended.amount)} por mês</span>}
          </div>
          <ul className="rows lead">
            {side.ended.plans.map((p) => (
              <li key={`${p.card}|${p.description}|${p.first}|${p.amount}`} className="bill">
                <span className="avatar pos" aria-hidden="true">
                  <IconCheck />
                </span>
                <span className="name">{planName(p)}</span>
                <span className="value">{money(p.part)}</span>
                <span className="meta">
                  {oneCard ? "" : `${p.card} · `}
                  {p.installments} de {p.installments} pagas
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
  return (
    <Board
      panels={{ hero, months, list }}
      // Wide screens: the month and its columns beside the list of plans.
      two={[["hero", "months"], ["list"]]}
    />
  );
};

/**
 * Faturas › Parcelas (specs/008-parcelas): every purchase in parcels, the owner's apart from each
 * person's. How much the month's bills carry and its weight, the months ahead with only what was
 * already bought, and when each plan ends with what it frees. A tap on a plan opens its timeline
 * and "De quem é?", which marks the whole plan.
 */
export const Parcels = ({
  view,
  month,
  today,
  people,
  waits,
  owedPeople,
}: {
  view: ParcelsView;
  /** The month Faturas is on: the columns open on it. */
  month: string;
  today: string;
  people: readonly string[];
  waits: readonly string[];
  /** People with a page in A receber for the month. */
  owedPeople: readonly string[];
}) => {
  const id = useId();
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => title.current?.focus({ preventScroll: true }), []);
  const [who, setWho] = useState<string | null>(view.sides[0]?.person ?? null);
  const [picked, setPicked] = useState<ParcelPlanView | null>(null);
  const side = view.sides.find((s) => s.person === who) ?? view.sides[0];
  if (!side) return null;
  const start = side.months.some((m) => m.key === month) ? month : view.month;
  return (
    <>
      <div className="parcels-head">
        <h2 className="page-title" ref={title} tabIndex={-1}>
          Parcelas
        </h2>
        {view.sides.length > 1 && (
          <fieldset className="chip-radios bill-filters">
            <legend className="sr-only">De quem são as parcelas</legend>
            {view.sides.map((s) => (
              <label key={s.person ?? "mine"} className="chip-radio">
                <input
                  type="radio"
                  name={`${id}-who`}
                  checked={s.person === side.person}
                  onChange={() => setWho(s.person)}
                />
                {s.person ?? "Suas"}
                <small>{s.count}</small>
              </label>
            ))}
          </fieldset>
        )}
      </div>
      <Side
        key={side.person ?? "mine"}
        side={side}
        view={view}
        start={start}
        today={today}
        hasPage={owedPeople.includes(side.person ?? "")}
        onPick={setPicked}
      />
      <Sheet
        open={picked !== null}
        title={picked ? planName(picked) : "Parcelas"}
        onClose={() => setPicked(null)}
      >
        {picked && (
          <PlanDetail
            p={picked}
            side={side.person}
            month={view.month}
            people={people}
            waits={waits}
            onDone={() => setPicked(null)}
          />
        )}
      </Sheet>
    </>
  );
};
