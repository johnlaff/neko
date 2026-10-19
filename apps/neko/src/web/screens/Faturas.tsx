import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  type BankLineView,
  type BuyGroup,
  type InvoiceMonthView,
  type InvoiceRow,
  invoicesView,
} from "../../shared/screens.ts";
import type { SubscriptionsView } from "../../shared/types.ts";
import { api } from "../api.ts";
import { Board } from "../Board.tsx";
import { BrandMark } from "../BrandMark.tsx";
import { CardAvatar } from "../CardAvatar.tsx";
import { BigMoney, Columns } from "../Figures.tsx";
import {
  bankLineName,
  bankText,
  capitalize,
  closesIn,
  days,
  merchantName,
  money,
  monthName,
  shortDate,
} from "../format.ts";
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
  // Non-breaking: a wrap falls at the "·", never inside the date.
  return (d === 0 ? "vence hoje" : d === 1 ? "vence amanhã" : `vence ${shortDate(due)}`).replaceAll(
    " ",
    "\u00a0",
  );
};

/** Where the bill stands, in one line: the row's only words besides its name. */
const stateLine = (c: InvoiceRow, today: string) => {
  const who = c.others ? "De outra pessoa · " : c.reimbursed ? "Reembolsada · " : "";
  return who + billState(c, today);
};

const billState = (c: InvoiceRow, today: string) => {
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

const LINES_SHOWN = 8;

/**
 * Whose a purchase is: someone you named before, a new name, or yours again. A parcel takes its
 * whole plan along, so every later bill follows.
 */
const OwnerPick = ({
  line,
  people,
  onDone,
}: {
  line: BankLineView & { key: string };
  people: readonly string[];
  onDone: () => void;
}) => {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const save = useMutation({
    mutationFn: (person: string | null) => api.markOwner(line.key, person),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projection"] });
      onDone();
    },
  });
  const plan = (line.installments ?? 1) > 1;
  return (
    <div className="owner-pick">
      <p className="hint">
        {plan ? "De quem são estas parcelas? Vale para todas." : "De quem é esta compra?"}
      </p>
      <div className="owner-chips">
        {people.map((p) => (
          <button
            key={p}
            type="button"
            className="chip-button"
            aria-pressed={line.person === p}
            disabled={save.isPending}
            onClick={() => (line.person === p ? onDone() : save.mutate(p))}
          >
            {p}
          </button>
        ))}
        {line.person && (
          <button
            type="button"
            className="chip-button"
            disabled={save.isPending}
            onClick={() => save.mutate(null)}
          >
            É minha
          </button>
        )}
      </div>
      <form
        className="owner-new"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) save.mutate(name.trim());
        }}
      >
        <input
          aria-label="Nome de outra pessoa"
          placeholder={people.length > 0 ? "Outra pessoa" : "Nome da pessoa"}
          autoCapitalize="words"
          autoComplete="off"
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="ghost small" disabled={save.isPending || !name.trim()}>
          Marcar
        </button>
      </form>
      {save.isPending && (
        <p className="saving" role="status">
          Salvando…
        </p>
      )}
      {save.isError && (
        <p className="warn" role="alert">
          Não salvou. Tente de novo.
        </p>
      )}
    </div>
  );
};

const BankLines = ({
  title,
  lines,
  people,
  hint,
}: {
  title: string;
  lines: readonly BankLineView[];
  people: readonly string[];
  /** Says the lines can be tapped, until someone has been named once. */
  hint: boolean;
}) => {
  const [all, setAll] = useState(false);
  const [picking, setPicking] = useState<number | null>(null);
  if (lines.length === 0) return null;
  const shown = all ? lines : lines.slice(0, LINES_SHOWN);
  return (
    // Closed by default: a bill can bring dozens of lines, the details above come first.
    <details className="formula bank-lines">
      <summary>
        {title} ({lines.length})
        <IconChevron />
      </summary>
      {hint && <p className="hint">Toque numa compra que é de outra pessoa.</p>}
      <ul>
        {shown.map((l, i) => {
          const when = parcelText(l) ?? (l.date ? shortDate(l.date) : "");
          const body = (
            <>
              <span className="text">
                {bankLineName(l)}
                <small>{l.person ? `De ${l.person}${when ? ` · ${when}` : ""}` : when}</small>
              </span>
              <span className="amount">{money(l.amount)}</span>
            </>
          );
          return (
            // The bank sends the same text twice for two equal purchases: the index tells them apart.
            // biome-ignore lint/suspicious/noArrayIndexKey: lines have no id of their own here.
            <li key={`${l.description}-${l.date}-${i}`} className={l.person ? "theirs" : undefined}>
              {l.key === null ? (
                body
              ) : (
                <button
                  type="button"
                  className="line-pick"
                  aria-expanded={picking === i}
                  aria-label={`${bankLineName(l)}, ${money(l.amount)}${l.person ? `, de ${l.person}` : ""}: marcar de quem é`}
                  onClick={() => setPicking(picking === i ? null : i)}
                >
                  {body}
                </button>
              )}
              {picking === i && l.key !== null && (
                <OwnerPick
                  line={{ ...l, key: l.key }}
                  people={people}
                  onDone={() => setPicking(null)}
                />
              )}
            </li>
          );
        })}
      </ul>
      {lines.length > shown.length && (
        <button type="button" className="ghost small" onClick={() => setAll(true)}>
          Ver mais {lines.length - shown.length}
        </button>
      )}
    </details>
  );
};

/** Someone else's purchases on the month's bills: what each will pay back, and what comes later. */
const Owed = ({ m }: { m: InvoiceMonthView }) => (
  <section className="panel">
    <div className="panel-head">
      <h2>A receber</h2>
      <span className="meta">Faturas de {monthOf(m.key)}</span>
    </div>
    <ul className="rows lead owed">
      {m.owed.map((o) => (
        <li key={o.person} className="bill">
          <span className="avatar person" aria-hidden="true">
            {o.person.slice(0, 1).toUpperCase()}
          </span>
          <span className="name">{o.person}</span>
          <span className="value">{money(o.total)}</span>
          <span className="meta">
            {o.lines === 1 ? "1 compra" : `${o.lines} compras`}
            {o.later > 0 && ` · mais ${money(o.later)} nas próximas parcelas`}
          </span>
        </li>
      ))}
    </ul>
    <p className="hint">Fica fora do teto das faturas. Quando pagarem, lance como Entrada.</p>
  </section>
);

/** Everything about one card's bill, opened from its row. */
const Detail = ({
  c,
  month,
  today,
  alone,
  people,
  onPick,
}: {
  c: InvoiceRow;
  month: string;
  today: string;
  /** The month's only card: its history is the top chart already. */
  alone: boolean;
  people: readonly string[];
  /** Opens another month of the screen, with this card still open. */
  onPick: (month: string) => void;
}) => {
  const isParcel = (l: BankLineView) => (l.installments ?? 1) > 1;
  return (
    <div className="invoice-detail">
      <dl className="ledger">
        <dt>Fecha</dt>
        <dd>
          {shortDate(c.closing)}
          {c.closingEstimated && " (estimado)"}
        </dd>
        {c.bank && (
          <>
            <dt>{c.bank.closed ? "No banco, fechada" : "No banco até agora"}</dt>
            <dd className={c.bank.disagrees ? "warn" : undefined}>{money(c.bank.amount)}</dd>
          </>
        )}
        {c.limit && (
          <>
            <dt>Limite livre</dt>
            <dd>{money(c.limit.available)}</dd>
          </>
        )}
      </dl>
      {!alone && c.history.filter((h) => h.amount !== 0).length > 1 && (
        <section className="trend">
          <h3 className="label">Faturas do {c.card}</h3>
          <Columns
            label={`Faturas do ${c.card} por mês`}
            selected={month}
            onSelect={onPick}
            items={c.history.map((h) => ({
              key: h.month,
              label: shortMonth(h.month),
              value: h.amount,
              description: `${capitalize(monthOf(h.month))}: ${money(h.amount)}`,
              tone:
                h.month > today.slice(0, 7)
                  ? h.month === month
                    ? "outline"
                    : "faint"
                  : h.month === month
                    ? "ink"
                    : undefined,
              // A month without this card's bill would close it: that bar opens nothing.
              disabled: h.amount === 0,
            }))}
          />
        </section>
      )}
      {c.bank && (
        <>
          <BankLines
            title="Compras novas no banco"
            lines={c.bank.lines.filter((l) => !isParcel(l))}
            people={people}
            hint={people.length === 0}
          />
          <BankLines
            title="Parcelas no banco"
            lines={c.bank.lines.filter(isParcel)}
            people={people}
            hint={people.length === 0}
          />
        </>
      )}
    </div>
  );
};

const InvoiceLine = ({
  c,
  month,
  today,
  alone,
  people,
  onPick,
}: {
  c: InvoiceRow;
  month: string;
  today: string;
  alone: boolean;
  people: readonly string[];
  onPick: (month: string) => void;
}) => {
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
      {open && (
        <Detail c={c} month={month} today={today} alone={alone} people={people} onPick={onPick} />
      )}
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

/**
 * Charges of the same value that came back each month on the owner's cards, with a mark for the ones
 * to cancel: the method tags them all to cancel on one day. Only what was charged; nothing ahead.
 */
const Subscriptions = ({ subs }: { subs: SubscriptionsView }) => {
  const queryClient = useQueryClient();
  const mark = useMutation({
    mutationFn: ({ key, on }: { key: string; on: boolean }) => api.markCancel(key, on),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projection"] }),
  });
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Assinaturas</h2>
        <span className="meta">{money(subs.total)} por mês</span>
      </div>
      <p className="hint">Marque o que você vai cancelar.</p>
      <ul className="rows subs">
        {subs.items.map((i) => {
          const name = bankText(merchantName(i.description));
          const saving = mark.isPending && mark.variables?.key === i.key;
          const on = saving ? mark.variables.on : i.cancel;
          return (
            <li key={i.key}>
              <span className="name">{name}</span>
              <span className="value">{money(i.amount)}</span>
              <button
                type="button"
                className="chip-button"
                aria-pressed={on}
                aria-label={`Vou cancelar ${name}`}
                disabled={saving}
                onClick={() => mark.mutate({ key: i.key, on: !on })}
              >
                {on ? "✓ Vou cancelar" : "Vou cancelar"}
              </button>
              <span className="meta">
                {i.card} · {i.charges} cobranças · última {shortDate(i.last)}
                {i.twin ? " · outro plano na mesma loja" : ""}
              </span>
            </li>
          );
        })}
      </ul>
      {mark.isError && (
        <p className="warn subs-total" role="alert">
          Não salvou. Tente de novo.
        </p>
      )}
      {subs.toCancel > 0 && (
        <p className="pos subs-total">Marcadas: {money(subs.toCancel)} a menos por mês</p>
      )}
    </section>
  );
};

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
                  <div className="figure-stack">
                    <span className="muted">
                      {m.past ? "Saiu da conta" : "Sai da conta"} em {monthOf(m.key)}
                    </span>
                    <BigMoney cents={m.total} tone="plain" />
                    {m.bank &&
                      (m.bank.disagree === 0 ? (
                        <span className="pos">✓ Banco não ultrapassa a planilha</span>
                      ) : (
                        <>
                          <span className="warn">
                            {m.bank.disagree === 1
                              ? `${m.cards.find((x) => x.bank?.disagrees)?.card ?? "1 cartão"} não confere com o banco`
                              : `${m.bank.disagree} cartões não conferem com o banco`}
                          </span>
                          {/* Para lançar has the change for each one: nothing is written without a tap. */}
                          <Link className="text-link" to="/" hash="h-queue">
                            Corrigir em Para lançar ›
                          </Link>
                        </>
                      ))}
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
                      tone:
                        x.key === m.key
                          ? x.future
                            ? "outline"
                            : "ink"
                          : x.future
                            ? "faint"
                            : undefined,
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
                        <span className="swatch" aria-hidden="true" />
                        Meses à frente: só o que já está na planilha
                      </span>
                    )}
                  </p>

                  <Hint id="faturas">{HINTS.faturas}</Hint>
                </section>
              ),
              cards: (
                <section className="panel">
                  <div className="panel-head">
                    <h2>Cartões</h2>
                    <span className="meta">Vencem em {monthOf(m.key)}</span>
                  </div>
                  {m.cards.length === 0 ? (
                    <p className="hint">Nenhuma fatura neste mês.</p>
                  ) : (
                    <ul className="rows lead invoices">
                      {m.cards.map((c) => (
                        <InvoiceLine
                          // By card only: it stays open while its chart picks another month.
                          key={c.card}
                          c={c}
                          month={m.key}
                          today={v.today}
                          alone={m.cards.length === 1}
                          people={v.people}
                          onPick={setPicked}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              ),
              owed: m.owed.length > 0 && <Owed m={m} />,
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
              subs: v.subscriptions && <Subscriptions subs={v.subscriptions} />,
            }}
            // Wide screens: the months beside the month's cards, then where to buy.
            two={[["months"], ["cards", "owed", "buy", "subs"]]}
            three={[["months"], ["cards", "owed"], ["buy", "subs"]]}
          />
        );
      }}
    </WithProjection>
  );
};
