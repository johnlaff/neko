import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { institutionOf } from "../../shared/institutions.ts";
import type { BankView } from "../../shared/types.ts";
import { Board } from "../Board.tsx";
import { BrandMark } from "../BrandMark.tsx";
import { CardAvatar } from "../CardAvatar.tsx";
import { BigMoney, Columns } from "../Figures.tsx";
import { capitalize, closesIn, days, money, monthName, shortDate } from "../format.ts";
import { Hint } from "../Hint.tsx";
import { CARDS_COME_FROM, HINTS } from "../learn.ts";
import { WithProjection } from "../useProjection.tsx";

const shortMonth = (iso: string) => capitalize(monthName(Number(iso.slice(5, 7))).slice(0, 3));

export const Faturas = () => {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <WithProjection>
      {({ projection: p, bank }) => {
        const usual = p.cards.find((c) => c.usual);
        const others = p.cards.filter((c) => !c.usual && c.onSheet !== 0);
        const empty = p.cards.filter((c) => c.onSheet === 0 && !c.usual);
        // Your own cards, the one that takes longest to charge a purchase made today first.
        // Only cards in use: open bill, the usual one, or a bill in the last months.
        const mine = p.cards
          .filter(
            (c) =>
              !c.others &&
              (c.usual || c.onSheet !== 0 || p.bills.some((b) => b.card === c.card.name)),
          )
          .toSorted((a, b) => b.payInDays - a.payInDays);
        // Cards with the same dates read as one line: "Amazon, Itau · 36 dias".
        const buyGroups: {
          key: string;
          cards: typeof mine;
          payInDays: number;
          due: string;
          best: string | number;
          estimated: boolean;
        }[] = [];
        for (const c of mine) {
          const best = c.bestDate ? shortDate(c.bestDate) : c.bestDay;
          const k = `${c.cycle.due}|${best}`;
          const g = buyGroups.find((x) => x.key === k);
          if (g) {
            g.cards = [...g.cards, c];
            g.estimated ||= c.card.closingEstimated;
          } else
            buyGroups.push({
              key: k,
              cards: [c],
              payInDays: c.payInDays,
              due: c.cycle.due,
              best,
              estimated: c.card.closingEstimated,
            });
        }
        const outros = (others.length > 0 || empty.length > 0) && (
          <section className="panel">
            <h2>Outros cartões</h2>
            <ul className="rows lead">
              {others.map((c) => (
                <li key={c.card.name} className="bill">
                  <CardAvatar name={c.card.name} />
                  <span className="name">
                    {c.card.name}
                    {c.others && <span className="chip plain">De outra pessoa</span>}
                    {c.reimbursed && <span className="chip plain">Reembolsada</span>}
                  </span>
                  <span className="value">{money(c.onSheet)}</span>
                  <span className="meta">Vence {shortDate(c.cycle.due)}</span>
                </li>
              ))}
            </ul>
            {empty.length > 0 && (
              <p className="hint">Sem compras: {empty.map((c) => c.card.name).join(", ")}.</p>
            )}
          </section>
        );
        if (p.cards.length === 0)
          return (
            <section className="page-head empty-cards">
              <BrandMark width={64} className="quiet-mark" />
              <h2>Nenhuma fatura</h2>
              <p className="muted">{CARDS_COME_FROM}</p>
            </section>
          );
        const bars = usual
          ? [
              ...p.history.map((h) => ({ key: h.due, amount: h.amount, open: false })),
              { key: usual.cycle.due, amount: usual.onSheet, open: true },
            ]
          : [];
        const shown = bars.find((b) => b.key === picked) ?? bars.at(-1);
        return (
          <Board
            panels={{
              hero: usual && (
                <section className="panel hero">
                  <div className="panel-head">
                    <h2 className="with-mark">
                      {/* The bank's mark only: two letters next to the name would just repeat it. */}
                      {institutionOf(usual.card.name) && <CardAvatar name={usual.card.name} />}
                      {usual.card.name}
                    </h2>
                    <span className={`chip ${usual.closesInDays <= 3 ? "warn" : "ok"}`}>
                      {/* An estimated day says so in words: a lone ≈ needed Ajustes to explain it. */}
                      {closesIn(usual.closesInDays)}
                      {usual.card.closingEstimated && " · estimado"}
                    </span>
                  </div>
                  <BigMoney cents={usual.onSheet} tone="plain" />
                  <ol className="timeline" aria-label="Datas da fatura">
                    <li className="step now">
                      <span className="label">Fecha</span>
                      <span className="date">{shortDate(usual.cycle.closing)}</span>
                      {usual.card.closingEstimated && <span className="sub">Estimado</span>}
                    </li>
                    <li className="step">
                      <span className="label">Vence</span>
                      <span className="date">{shortDate(usual.cycle.due)}</span>
                      <span className="sub">Sai da conta</span>
                    </li>
                  </ol>
                  <Hint id="faturas">{HINTS.faturas}</Hint>
                </section>
              ),
              history: usual && p.history.length > 0 && shown && (
                <section className="panel">
                  <div className="panel-head">
                    <h2>Histórico</h2>
                    {p.openVsAverage !== null && (
                      <span className={`chip ${p.openVsAverage <= 0 ? "ok" : "warn"}`}>
                        {money(Math.abs(p.openVsAverage))}{" "}
                        {p.openVsAverage <= 0 ? "abaixo" : "acima"} da média
                      </span>
                    )}
                  </div>
                  {/* The open bill is already the hero's number: until a bar is picked, the line
                    shows the average the bars are read against. */}
                  {picked === null && p.historyAverage !== null ? (
                    <p className="figure-line">
                      <span className="muted">
                        <i className="key dashed" />
                        Média
                      </span>
                      <strong>{money(p.historyAverage)}</strong>
                    </p>
                  ) : (
                    <p className="figure-line">
                      <span className="muted">
                        {shortMonth(shown.key)}
                        {shown.open ? ", aberta" : ""}
                      </span>
                      <strong>{money(shown.amount)}</strong>
                    </p>
                  )}
                  <Columns
                    label={`Faturas do ${usual.card.name}`}
                    selected={shown.key}
                    onSelect={setPicked}
                    guide={p.historyAverage}
                    items={bars.map((b) => ({
                      key: b.key,
                      label: shortMonth(b.key),
                      value: b.amount,
                      description: `${shortMonth(b.key)}${b.open ? ", fatura aberta" : ""}: ${money(b.amount)}`,
                      tone: b.key === shown.key ? "ink" : undefined,
                    }))}
                  />
                </section>
              ),
              buy: mine.length > 1 && (
                <section className="panel">
                  <div className="panel-head">
                    <h2>Comprar hoje</h2>
                    <span className="meta">Mais prazo primeiro</span>
                  </div>
                  <ul className="rows lead">
                    {buyGroups.map((g, i) => (
                      // The first group waits longest; every card in it is as good as the others.
                      <li key={g.key} className={`bill${i === 0 ? " best" : ""}`}>
                        <CardAvatar name={g.cards[0]?.card.name ?? ""} />
                        <span className="name">{g.cards.map((c) => c.card.name).join(", ")}</span>
                        <span className="value">{days(g.payInDays)}</span>
                        <span className="meta">
                          Paga em {shortDate(g.due)} · Melhor dia {g.estimated ? "≈ " : ""}
                          {g.best}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {mine.some((c) => c.card.closingEstimated) && (
                    <Link className="text-link" to="/ajustes">
                      Dias com ≈ são estimados. Corrigir em Ajustes
                    </Link>
                  )}
                </section>
              ),
              outros,
              bank: bank && <BankBills bank={bank} />,
            }}
            // Wide screens: each column takes the next panels in the phone's order, the open bill
            // first and what the bank already has last.
            two={[
              ["hero", "history"],
              ["buy", "outros", "bank"],
            ]}
            three={[["hero"], ["history", "buy"], ["outros", "bank"]]}
          />
        );
      }}
    </WithProjection>
  );
};

/**
 * The next bills as the bank already has them: purchases so far plus the parcels still owed,
 * next to what the sheet expects. Only a bill already above the sheet gets color.
 */
const BankBills = ({ bank }: { bank: BankView }) => (
  <section className="panel">
    <div className="panel-head">
      <h2>Faturas no banco</h2>
      {bank.syncedAt && <span className="meta">Lido {shortDate(bank.syncedAt.slice(0, 10))}</span>}
    </div>
    {bank.checks.length === 0 ? (
      <p className="hint">
        Nenhuma fatura futura dos cartões ligados.{" "}
        <Link className="text-link" to="/ajustes">
          Ligar cartões em Ajustes
        </Link>
      </p>
    ) : (
      <ul className="rows lead">
        {bank.checks.map((c) => (
          <li key={`${c.card}-${c.due}`} className="bill">
            <CardAvatar name={c.card} />
            <span className="name">
              {c.card} · {shortMonth(c.due)}
              {c.gap > 0 && <span className="chip warn">{money(c.gap)} acima da planilha</span>}
            </span>
            <span className="value">{money(c.bank)}</span>
            <span className="meta">
              Na planilha {money(c.sheet)}
              {c.parcels > 0 && c.parcels === c.bank
                ? " · No banco, por enquanto só as parcelas"
                : c.parcels > 0
                  ? ` · ${money(c.parcels)} do banco são parcelas`
                  : ""}
            </span>
          </li>
        ))}
      </ul>
    )}
  </section>
);
