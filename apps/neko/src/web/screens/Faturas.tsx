import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  type BankLineView,
  type BuyGroup,
  type InvoiceRow,
  invoicesView,
} from "../../shared/screens.ts";
import { Board } from "../Board.tsx";
import { BrandMark } from "../BrandMark.tsx";
import { CardAvatar } from "../CardAvatar.tsx";
import { BigMoney, Columns } from "../Figures.tsx";
import { bankText, capitalize, closesIn, days, money, monthName, shortDate } from "../format.ts";
import { Hint } from "../Hint.tsx";
import { IconChevron } from "../icons.tsx";
import { CARDS_COME_FROM, HINTS } from "../learn.ts";
import { WithProjection } from "../useProjection.tsx";

const monthOf = (key: string) => monthName(Number(key.slice(5, 7)));
const shortMonth = (key: string) => capitalize(monthOf(key).slice(0, 3));
const dayIndex = (iso: string) => Date.parse(`${iso}T12:00:00Z`) / 86_400_000;

/** `vence hoje`, `vence amanhã`, `vence 12 nov`. */
const dueText = (due: string, today: string) => {
  const d = Math.round(dayIndex(due) - dayIndex(today));
  return d === 0 ? "vence hoje" : d === 1 ? "vence amanhã" : `vence ${shortDate(due)}`;
};

/** Where the bill stands, in one line: the row's only words besides its name. */
const stateLine = (c: InvoiceRow, today: string) => {
  if (c.state === "due") return `Venceu ${shortDate(c.due)}`;
  const due = dueText(c.due, today);
  if (c.state === "closed" || c.bank?.closed) return `Fechada · ${due}`;
  if (c.state === "future") return capitalize(due);
  const open = c.bank?.onlyParcels
    ? "Só parcelas por enquanto"
    : `${closesIn(c.closesInDays)}${c.closingEstimated ? " (estimado)" : ""}`;
  return `${open} · ${due}`;
};

/** `3/10 · Faltam 7`, the way a bill writes a parcel. */
const parcelText = (l: BankLineView) =>
  l.installment !== null && l.installments !== null
    ? `${l.installment}/${l.installments}${l.installments > l.installment ? ` · Faltam ${l.installments - l.installment}` : " · Última"}`
    : null;

/** The bank writes the parcel into the text too ("LOJA PARC 03/06"); the line already says it. */
const lineName = (l: BankLineView) =>
  bankText(
    l.installment === null
      ? l.description
      : l.description.replace(/\s*(parc(ela)?\.?\s*)?\d{1,2}\s*\/\s*\d{1,2}\s*$/i, ""),
  );

const LINES_SHOWN = 8;

const BankLines = ({ title, lines }: { title: string; lines: readonly BankLineView[] }) => {
  const [all, setAll] = useState(false);
  if (lines.length === 0) return null;
  const shown = all ? lines : lines.slice(0, LINES_SHOWN);
  return (
    <section className="bank-lines">
      <h3 className="label">{title}</h3>
      <ul>
        {shown.map((l, i) => (
          // The bank sends the same text twice for two equal purchases: the index tells them apart.
          // biome-ignore lint/suspicious/noArrayIndexKey: lines have no id of their own here.
          <li key={`${l.description}-${l.date}-${i}`}>
            <span className="text">
              {lineName(l)}
              <small>{parcelText(l) ?? (l.date ? shortDate(l.date) : "")}</small>
            </span>
            <span className="amount">{money(l.amount)}</span>
          </li>
        ))}
      </ul>
      {lines.length > shown.length && (
        <button type="button" className="ghost small" onClick={() => setAll(true)}>
          Ver mais {lines.length - shown.length}
        </button>
      )}
    </section>
  );
};

/** Everything about one card's bill, opened from its row. */
const Detail = ({ c, month, today }: { c: InvoiceRow; month: string; today: string }) => {
  const isParcel = (l: BankLineView) => (l.installments ?? 1) > 1;
  return (
    <div className="invoice-detail">
      <dl className="ledger">
        <dt>Fecha</dt>
        <dd>
          {shortDate(c.closing)}
          {c.closingEstimated && " (estimado)"}
        </dd>
        <dt>Vence</dt>
        <dd>{shortDate(c.due)}</dd>
        {c.bank && (
          <>
            <dt>{c.bank.closed ? "No banco, fechada" : "No banco até agora"}</dt>
            <dd className={c.bank.disagrees ? "warn" : undefined}>{money(c.bank.amount)}</dd>
          </>
        )}
        {c.limit && (
          <>
            <dt>Limite livre</dt>
            <dd>
              {money(c.limit.available)} <span className="muted">de {money(c.limit.limit)}</span>
            </dd>
          </>
        )}
      </dl>
      {c.bank && (
        <>
          <BankLines title="Compras novas" lines={c.bank.lines.filter((l) => !isParcel(l))} />
          <BankLines title="Parcelas" lines={c.bank.lines.filter(isParcel)} />
        </>
      )}
      {c.history.filter((h) => h.amount !== 0).length > 1 && (
        <section className="trend">
          <h3 className="label">Faturas do {c.card}</h3>
          <Columns
            label={`Faturas do ${c.card} por mês`}
            selected={month}
            items={c.history.map((h) => ({
              key: h.month,
              label: shortMonth(h.month),
              value: h.amount,
              description: `${capitalize(monthOf(h.month))}: ${money(h.amount)}`,
              tone: h.month === month ? "ink" : h.month > today.slice(0, 7) ? "faint" : undefined,
            }))}
          />
        </section>
      )}
    </div>
  );
};

const InvoiceLine = ({ c, month, today }: { c: InvoiceRow; month: string; today: string }) => {
  const [open, setOpen] = useState(false);
  const gap = c.bank?.gap ?? 0;
  return (
    <li className={`bill invoice${open ? " open" : ""}`}>
      <button
        type="button"
        className="row-toggle"
        aria-expanded={open}
        aria-label={`${c.card}: ${open ? "fechar" : "ver"} detalhes`}
        onClick={() => setOpen(!open)}
      />
      <CardAvatar name={c.card} />
      <span className="name">
        {c.card}
        {c.others && <span className="chip plain">De outra pessoa</span>}
        {c.reimbursed && <span className="chip plain">Reembolsada</span>}
        {/* The bank only shows up when the sheet should change. */}
        {c.bank?.disagrees && (
          <span className="chip warn">
            Banco {gap > 0 ? "+" : "−"}
            {money(Math.abs(gap))}
          </span>
        )}
      </span>
      <span className="value">
        <span className="opens">
          {money(c.amount)}
          <IconChevron />
        </span>
      </span>
      <span className="meta">{stateLine(c, today)}</span>
      {open && <Detail c={c} month={month} today={today} />}
    </li>
  );
};

const BuyLine = ({ g, best }: { g: BuyGroup; best: boolean }) => (
  <li className={`bill${best ? " best" : ""}`}>
    <CardAvatar name={g.cards[0] ?? ""} />
    <span className="name">{g.cards.join(", ")}</span>
    <span className="value">Paga em {days(g.payInDays)}</span>
    <span className="meta">
      Vence {shortDate(g.due)} · Melhor dia {g.estimated ? "≈ " : ""}
      {shortDate(g.bestDate)}
    </span>
  </li>
);

export const Faturas = () => {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <WithProjection>
      {(r) => {
        const v = invoicesView(r);
        if (!v.hasCards || v.months.length === 0)
          return (
            <section className="page-head empty-cards">
              <BrandMark width={64} className="quiet-mark" />
              <h2>Nenhuma fatura</h2>
              <p className="muted">{CARDS_COME_FROM}</p>
            </section>
          );
        const m =
          v.months.find((x) => x.key === (picked ?? v.current)) ?? (v.months.at(-1) as never);
        const [best, ...rest] = v.buyToday;
        const ahead = v.months.some((x) => x.future);
        return (
          <Board
            panels={{
              months: (
                <section className="panel">
                  <div className="panel-head">
                    <h2>Por mês</h2>
                    {v.bank?.syncedAt && (
                      <span className="meta">
                        Banco lido {shortDate(v.bank.syncedAt.slice(0, 10))}
                      </span>
                    )}
                  </div>
                  <Columns
                    label="Faturas de todos os cartões, por mês de vencimento"
                    selected={m.key}
                    onSelect={setPicked}
                    guide={v.average}
                    items={v.months.map((x) => ({
                      key: x.key,
                      label: shortMonth(x.key),
                      value: x.total,
                      description: `${capitalize(monthOf(x.key))}: ${money(x.total)}${x.future ? ", já na planilha" : ""}`,
                      tone: x.key === m.key ? "ink" : x.future ? "faint" : undefined,
                    }))}
                  />
                  <p className="columns-key">
                    {v.average !== null && (
                      <span>
                        <i className="key dashed" />
                        Média {money(v.average)}
                      </span>
                    )}
                    {ahead && (
                      <span>
                        <span className="swatch" aria-hidden="true" />À frente, o que já está na
                        planilha
                      </span>
                    )}
                  </p>
                  <div className="figure-stack">
                    <span className="muted">
                      {m.past ? "Saiu da conta" : "Sai da conta"} em {monthOf(m.key)}
                    </span>
                    <BigMoney cents={m.total} tone="plain" />
                    {m.bank &&
                      (m.bank.disagree === 0 ? (
                        <span className="pos">✓ Banco confere com a planilha</span>
                      ) : (
                        <span className="warn">
                          {m.bank.disagree === 1
                            ? "1 cartão não confere com o banco"
                            : `${m.bank.disagree} cartões não conferem com o banco`}
                        </span>
                      ))}
                  </div>
                  <Hint id="faturas">{HINTS.faturas}</Hint>
                </section>
              ),
              cards: (
                <section className="panel">
                  <div className="panel-head">
                    <h2>{capitalize(monthOf(m.key))}</h2>
                    <span className="meta">
                      {m.cards.length === 1 ? "1 cartão" : `${m.cards.length} cartões`}
                    </span>
                  </div>
                  {m.cards.length === 0 ? (
                    <p className="hint">Nenhuma fatura neste mês.</p>
                  ) : (
                    <ul className="rows lead invoices">
                      {m.cards.map((c) => (
                        <InvoiceLine
                          key={`${m.key}-${c.card}`}
                          c={c}
                          month={m.key}
                          today={v.today}
                        />
                      ))}
                    </ul>
                  )}
                  {m.bank && m.bank.parcels > 0 && (
                    <div className="split">
                      <span className="split-bar" aria-hidden="true">
                        <i
                          className="old"
                          style={{
                            width: `${(m.bank.parcels / Math.max(1, m.bank.parcels + m.bank.fresh)) * 100}%`,
                          }}
                        />
                      </span>
                      <p className="columns-key">
                        <span>
                          <span className="swatch old" aria-hidden="true" />
                          Parcelas {money(m.bank.parcels)}
                        </span>
                        <span>
                          <span className="swatch fresh" aria-hidden="true" />
                          Compras novas {money(Math.max(0, m.bank.fresh))}
                        </span>
                      </p>
                    </div>
                  )}
                </section>
              ),
              buy: best && (
                <section className="panel">
                  <div className="panel-head">
                    <h2>Comprar hoje</h2>
                    <span className="meta">Mais prazo primeiro</span>
                  </div>
                  <ul className="rows lead">
                    <BuyLine g={best} best />
                  </ul>
                  {rest.length > 0 && (
                    <details className="formula more-buy">
                      <summary>
                        Ver todos
                        <IconChevron />
                      </summary>
                      <ul className="rows lead">
                        {rest.map((g) => (
                          <BuyLine key={`${g.due}-${g.cards.join()}`} g={g} best={false} />
                        ))}
                      </ul>
                    </details>
                  )}
                  {v.buyToday.some((g) => g.estimated) && (
                    <Link className="text-link" to="/ajustes">
                      Dias com ≈ são estimados. Corrigir em Ajustes
                    </Link>
                  )}
                </section>
              ),
            }}
            // Wide screens: the months beside the month's cards, then where to buy.
            two={[["months"], ["cards", "buy"]]}
            three={[["months"], ["cards"], ["buy"]]}
          />
        );
      }}
    </WithProjection>
  );
};
