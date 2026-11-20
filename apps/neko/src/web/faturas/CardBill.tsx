import { Link } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import type { BankLineView, InvoiceRow } from "../../shared/screens.ts";
import { Board } from "../Board.tsx";
import { CardAvatar } from "../CardAvatar.tsx";
import { CategoryIcon } from "../CategoryIcon.tsx";
import { BigMoney, Columns } from "../Figures.tsx";
import { bankLineName, capitalize, money, shortDate } from "../format.ts";
import { IconChevron, IconReceipt } from "../icons.tsx";
import { Sheet } from "../Sheet.tsx";
import { OwnerForm } from "./Owner.tsx";
import { buyDay, isParcel, monthOf, monthYear, parcelText, shortMonth, stateLine } from "./text.ts";

type Filter = "all" | "buys" | "parcels" | `p:${string}`;

/** Under a purchase's name: its parcel and plan, whose part it is, where it came from. */
const lineMeta = (l: BankLineView) =>
  [
    parcelText(l),
    l.person &&
      (l.part !== null && l.part < l.amount
        ? `Dividida · ${l.person} paga ${money(l.part)}`
        : `De ${l.person}`),
    l.fromStatement && "da fatura em PDF",
  ]
    .filter(Boolean)
    .join(" · ");

const LineRow = ({ l, onPick }: { l: BankLineView; onPick: (() => void) | null }) => {
  const body = (
    <>
      <span className="avatar" aria-hidden="true">
        <CategoryIcon text={l.description} fallback={<IconReceipt />} />
      </span>
      <span className="name">{bankLineName(l)}</span>
      <span className={`value${l.person ? " theirs" : ""}`}>
        {money(l.amount)}
        {onPick && <IconChevron />}
      </span>
      {lineMeta(l) && <span className="meta">{lineMeta(l)}</span>}
    </>
  );
  return (
    <li className={`bill${l.person ? " theirs" : ""}`}>
      {onPick ? (
        <button
          type="button"
          className="row-link"
          aria-haspopup="dialog"
          aria-label={`${bankLineName(l)}, ${money(l.amount)}${l.person ? `, de ${l.person}` : ""}: de quem é`}
          onClick={onPick}
        >
          {body}
        </button>
      ) : (
        body
      )}
    </li>
  );
};

/**
 * One card's bill on a page of its own (Faturas › a card): the total, how much of it is the owner's
 * and how much someone else's, the bill's facts and months, then the bank's purchases by day with
 * the parcels apart, filtered by kind or person. A tap on a purchase asks whose it is.
 */
export const CardBill = ({
  c,
  month,
  today,
  people,
  waits,
  onPickMonth,
}: {
  c: InvoiceRow;
  month: string;
  today: string;
  people: readonly string[];
  waits: readonly string[];
  onPickMonth: (month: string) => void;
}) => {
  const id = useId();
  const [filter, setFilter] = useState<Filter>("all");
  const [picked, setPicked] = useState<BankLineView | null>(null);
  const lines = c.bank?.lines ?? [];
  const persons = [...new Set(lines.flatMap((l) => (l.person ? [l.person] : [])))];
  const filters: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: "Tudo", count: lines.length },
    { key: "buys", label: "Compras", count: lines.filter((l) => !isParcel(l)).length },
    { key: "parcels", label: "Parcelas", count: lines.filter(isParcel).length },
    ...persons.map((p) => ({
      key: `p:${p}` as Filter,
      label: p,
      count: lines.filter((l) => l.person === p).length,
    })),
  ];
  const pass = (l: BankLineView) =>
    filter === "all" ||
    (filter === "buys" && !isParcel(l)) ||
    (filter === "parcels" && isParcel(l)) ||
    (filter.startsWith("p:") && l.person === filter.slice(2));
  const shown = lines.filter(pass);
  // Purchases by day, newest first; the parcels of older purchases together at the end.
  const groups: { key: string; items: BankLineView[] }[] = [];
  for (const l of shown
    .filter((x) => !isParcel(x))
    .toSorted((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))) {
    const key = l.date ? buyDay(l.date, today) : "Sem data";
    const g = groups.find((x) => x.key === key);
    if (g) g.items.push(l);
    else groups.push({ key, items: [l] });
  }
  const parcels = shown.filter(isParcel);
  if (parcels.length > 0) groups.push({ key: "Parcelas", items: parcels });
  const history = c.history.filter((h) => h.amount !== 0);
  const title = useRef<HTMLHeadingElement>(null);
  // Opened from a row: the page's name is read first, as a new screen's would be.
  useEffect(() => title.current?.focus({ preventScroll: true }), []);
  const head = (
    <section className="panel bill-head">
      <div className="sheet-item">
        <CardAvatar name={c.card} />
        <h2 className="name" ref={title} tabIndex={-1}>
          {c.card}
        </h2>
        <span className="meta">{stateLine(c, today)}</span>
      </div>
      <div className="figure-stack">
        <span className="muted">Na planilha</span>
        <BigMoney cents={c.amount} tone="plain" />
      </div>
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
      {c.split && (
        <div className="bill-split">
          <h3 className="label">Das compras no banco</h3>
          <div
            className="split-bar"
            role="img"
            aria-label={`Das compras no banco: seu ${money(c.split.mine)}, ${c.split.theirs.map((t) => `de ${t.person} ${money(t.amount)}`).join(", ")}`}
          >
            <i style={{ flexGrow: Math.max(0, c.split.mine) }} />
            {c.split.theirs.map((t) => (
              <i key={t.person} className="them" style={{ flexGrow: t.amount }} />
            ))}
          </div>
          <p className="split-key" aria-hidden="true">
            <span>Seu {money(c.split.mine)} · conta no teto</span>
            {c.split.theirs.map((t) => (
              <span key={t.person} className="them">
                {t.person} {money(t.amount)}
              </span>
            ))}
          </p>
        </div>
      )}
      {history.length > 1 && (
        <section className="trend">
          <h3 className="label">Faturas do {c.card}</h3>
          <Columns
            label={`Faturas do ${c.card} por mês`}
            selected={month}
            onSelect={onPickMonth}
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
              // A month without this card's bill would show nothing: that bar opens nothing.
              disabled: h.amount === 0,
            }))}
          />
        </section>
      )}
    </section>
  );
  const list = (
    <section className="panel bill-lines">
      <div className="panel-head">
        <h2>Compras no banco</h2>
      </div>
      {lines.length === 0 ? (
        <p className="hint">
          {c.bank
            ? "O banco ainda não mandou compras desta fatura."
            : "Este cartão não está ligado a um banco, então as compras não aparecem aqui."}
        </p>
      ) : (
        <>
          <fieldset className="chip-radios bill-filters">
            <legend className="sr-only">Mostrar</legend>
            {filters
              .filter((f) => f.count > 0 || f.key === "all")
              .map((f) => (
                <label key={f.key} className="chip-radio">
                  <input
                    type="radio"
                    name={`${id}-filter`}
                    checked={filter === f.key}
                    onChange={() => setFilter(f.key)}
                  />
                  {f.label}
                  <small>{f.count}</small>
                </label>
              ))}
          </fieldset>
          {filter === "parcels" && c.bank && c.bank.parcels > 0 && (
            <div className="parcel-sum">
              <div className="parcel-pick-top">
                <span className="muted">Parcelas nesta fatura</span>
                <b>{money(c.bank.parcels)}</b>
              </div>
              {c.bank.parcelsUntil && (
                <span className="hint">A última acaba em {monthYear(c.bank.parcelsUntil)}</span>
              )}
              <Link
                className="text-link"
                to="/faturas"
                search={{ m: month, cartao: c.card, parcelas: true }}
              >
                Ver todas as parcelas{"\u00a0"}
                <span aria-hidden="true">›</span>
              </Link>
            </div>
          )}
          <p className="hint">Toque numa compra para dizer de quem é, ou para dividir.</p>
          {groups.map((g) => (
            <div key={g.key} className="day-group">
              {/* Under the Parcelas filter, its chip and total already name the group. */}
              {filter !== "parcels" && <h3>{g.key}</h3>}
              <ul className="rows lead">
                {g.items.map((l, i) => (
                  <LineRow
                    // The bank sends the same text twice for two equal purchases: the index tells them apart.
                    // biome-ignore lint/suspicious/noArrayIndexKey: lines have no id of their own here.
                    key={`${l.description}-${l.date}-${i}`}
                    l={l}
                    onPick={l.key === null ? null : () => setPicked(l)}
                  />
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
    </section>
  );
  return (
    <>
      {/* Wide screens: the bill beside its purchases. */}
      <Board panels={{ head, list }} two={[["head"], ["list"]]} />
      <Sheet open={picked !== null} title="De quem é?" onClose={() => setPicked(null)}>
        {picked?.key && (
          <>
            <div className="sheet-item">
              <span className="avatar" aria-hidden="true">
                <CategoryIcon text={picked.description} fallback={<IconReceipt />} />
              </span>
              <span className="name">{bankLineName(picked)}</span>
              <span className="value">{money(picked.amount)}</span>
              <span className="meta">
                {c.card} ·{" "}
                {isParcel(picked)
                  ? `parcela ${picked.installment} de ${picked.installments}`
                  : picked.date
                    ? shortDate(picked.date)
                    : `fatura de ${monthOf(month)}`}
              </span>
            </div>
            <OwnerForm
              markKey={picked.key}
              amount={picked.amount}
              current={picked.person ? { person: picked.person, share: picked.part } : null}
              installments={picked.installments}
              due={c.due}
              monthly={false}
              people={people}
              waits={waits}
              onDone={() => setPicked(null)}
            />
          </>
        )}
      </Sheet>
    </>
  );
};
