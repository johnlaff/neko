import type { Insight } from "@neko/engine";
import { Link } from "@tanstack/react-router";
import { capitalize, money, monthName, shortDate } from "./format.ts";
import { IconChevron } from "./icons.tsx";

/** Each warning in a few words, with the figure that shows it and where to look next. */
export const insightView = (i: Insight) => {
  switch (i.kind) {
    case "goes-negative":
      return {
        tone: "bad",
        to: "/mes",
        month: i.start.slice(0, 7),
        title: i.already
          ? "Saldo negativo agora"
          : `Saldo negativo a partir de ${shortDate(i.start)}`,
        detail:
          i.already && i.until
            ? `Positivo de novo em ${shortDate(i.until)}. No pior dia, faltam ${money(-i.deepest)}`
            : `No pior dia, ${shortDate(i.deepestDate)}, faltam ${money(-i.deepest)}`,
      } as const;
    case "month-negative":
      return {
        tone: "warn",
        to: "/mes",
        month: `${i.year}-${String(i.month).padStart(2, "0")}`,
        title: `${capitalize(monthName(i.month))} gasta mais do que entra`,
        detail: `Saem ${money(i.amount)} a mais`,
      } as const;
    case "income-committed":
      return {
        tone: "warn",
        to: "/mes",
        month: `${i.year}-${String(i.month).padStart(2, "0")}`,
        title: `${capitalize(monthName(i.month))}: ${i.share}% da renda já tem destino`,
        detail:
          i.amount > 0
            ? `Sobram ${money(i.amount)} para o Diário`
            : `Faltam ${money(-i.amount)} antes do Diário`,
      } as const;
    case "no-spending-ahead":
      return {
        tone: "warn",
        to: "/mes",
        month: `${i.year}-${String(i.month).padStart(2, "0")}`,
        title: `${capitalize(monthName(i.month))} ainda sem gastos previstos`,
        detail: "Sem diário nem fatura lançados, esse saldo ainda está alto",
      } as const;
    case "bill-above-average":
      return {
        tone: "warn",
        to: "/faturas",
        title: "Fatura acima do normal",
        detail: `${i.card}: ${money(i.over)} acima da média`,
      } as const;
    case "fixed-up":
      return {
        tone: "warn",
        to: "/mes",
        title: `${capitalize(i.label)} subiu`,
        detail: `${money(i.amount)} este mês, ${money(i.change)} a mais`,
      } as const;
    case "closing-estimated":
      return {
        // A setup question, not a warning: color stays for real deviations.
        tone: "ask",
        to: "/ajustes",
        title: `Qual dia fecha o ${i.card}?`,
        detail: `Estimado: fecha perto de ${shortDate(i.closing)}. Confirme em Ajustes`,
      } as const;
    default:
      // A copy cached by an older version can carry a kind this one no longer knows.
      return null;
  }
};

/** Warnings as calm rows, each one opening where to look next: Hoje's now, Mês's months ahead. */
export const AlertList = ({
  items,
  label = "Avisos",
}: {
  items: readonly Insight[];
  label?: string;
}) => (
  <ul className="alerts" aria-label={label}>
    {items.map((i) => {
      const v = insightView(i);
      if (!v) return null;
      return (
        <li key={i.kind}>
          <Link to={v.to} search={"month" in v ? { m: v.month } : {}} className={`alert ${v.tone}`}>
            <span className="alert-dot" aria-hidden="true" />
            <span className="alert-text">
              <strong>{v.title}</strong>
              <span>{v.detail}</span>
            </span>
            <IconChevron />
          </Link>
        </li>
      );
    })}
  </ul>
);
