import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { BigMoney, Columns } from "../Figures.tsx";
import { capitalize, days, money, monthName, shortDate } from "../format.ts";
import { Hint } from "../Hint.tsx";
import { HINTS } from "../learn.ts";
import { WithProjection } from "../useProjection.tsx";

/** Two letters for a card's avatar: "Mercado Pago" → "MP", "Amazon" → "AM". */
const monogram = (name: string) => {
  const words = name.split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1 ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}` : name.slice(0, 2);
  return letters.toUpperCase();
};

const shortMonth = (iso: string) => capitalize(monthName(Number(iso.slice(5, 7))).slice(0, 3));

export const Faturas = () => {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <WithProjection>
      {({ projection: p }) => {
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
        const halvesBefore = (usual && p.history.length > 0 ? 1 : 0) + (mine.length > 1 ? 1 : 0);
        if (p.cards.length === 0)
          return (
            <section className="page-head">
              <h1>Nenhuma fatura</h1>
              <p className="muted">
                O Neko procura cartões nas notas de Saída, debaixo de CARTÕES.
              </p>
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
          <>
            <h1 className="sr-only">Faturas</h1>
            {usual && (
              <section className="panel hero">
                <div className="panel-head">
                  <h2>{usual.card.name}</h2>
                  <span className={`chip ${usual.closesInDays <= 3 ? "warn" : "ok"}`}>
                    {usual.closesInDays <= 1
                      ? "Fecha hoje"
                      : `Fecha em ${days(usual.closesInDays)}`}
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
            )}

            {usual && p.history.length > 0 && shown && (
              <section className="panel half">
                <div className="panel-head">
                  <h2>Histórico</h2>
                  {p.openVsAverage !== null && (
                    <span className={`chip ${p.openVsAverage <= 0 ? "ok" : "warn"}`}>
                      {money(Math.abs(p.openVsAverage))} {p.openVsAverage <= 0 ? "abaixo" : "acima"}{" "}
                      da média
                    </span>
                  )}
                </div>
                <p className="figure-line">
                  <span className="muted">
                    {shortMonth(shown.key)}
                    {shown.open ? ", aberta" : ""}
                  </span>
                  <strong>{money(shown.amount)}</strong>
                </p>
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
                    tone: b.key === shown.key ? "accent" : undefined,
                  }))}
                />
                {p.historyAverage !== null && (
                  <p className="hint">
                    <i className="key dashed" />
                    Média {money(p.historyAverage)}
                  </p>
                )}
              </section>
            )}

            {mine.length > 1 && (
              <section className="panel half">
                <div className="panel-head">
                  <h2>Comprar hoje</h2>
                  <span className="meta">Mais prazo primeiro</span>
                </div>
                <ul className="rows lead">
                  {buyGroups.map((g, i) => (
                    // The first group waits longest; every card in it is as good as the others.
                    <li key={g.key} className={`bill${i === 0 ? " best" : ""}`}>
                      <span className="avatar mono" aria-hidden="true">
                        {monogram(g.cards[0]?.card.name ?? "")}
                      </span>
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
            )}

            {(others.length > 0 || empty.length > 0) && (
              // Half width only when it has a partner on its row; alone it spans the page.
              <section className={`panel${halvesBefore % 2 === 1 ? " half" : ""}`}>
                <h2>Outros cartões</h2>
                <ul className="rows lead">
                  {others.map((c) => (
                    <li key={c.card.name} className="bill">
                      <span className="avatar mono" aria-hidden="true">
                        {monogram(c.card.name)}
                      </span>
                      <span className="name">
                        {c.card.name}
                        {c.others && <span className="chip">De outra pessoa</span>}
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
            )}
          </>
        );
      }}
    </WithProjection>
  );
};
