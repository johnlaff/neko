import { type Cents, formatBRL, type SubscriptionNews, type WatchNews } from "@neko/engine";
import { bankText } from "./text.ts";
import type { Mia2Rotina, MiaNote } from "./types.ts";

/**
 * Mia's line at the top of Hoje and the watch's notification, in words (specs/004-mia, "A linha
 * da Mia em Hoje"). The sentences come from the rules' own numbers, so they cost nothing and are
 * never wrong; Mia answers only when the line is tapped.
 */

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const day = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
// Intl puts a non-breaking space after R$; a plain one reads the same and wraps like the rest.
const money = (c: Cents) => formatBRL(c).replace(/\s/g, " ");
/** "a, b e c", as a sentence lists things. */
const listOf = (items: readonly string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} e ${items.at(-1)}`;

/** "18 nov", "18 e 19 nov", "30 nov e 1 dez": the days a charge came, the month said once. */
export const daysText = (dates: readonly string[]): string => {
  const unique = [...new Set(dates)].sort();
  const month = unique[0]?.slice(0, 7);
  if (unique.every((d) => d.slice(0, 7) === month))
    return listOf(
      unique.map((d, i) => (i === unique.length - 1 ? day(d) : String(Number(d.slice(8, 10))))),
    );
  return listOf(unique.map(day));
};

const TIMES = ["", "uma vez", "duas vezes", "três vezes"];
const times = (n: number) => TIMES[n] ?? `${n} vezes`;

/** What a finding says: the small title, the sentence, and the question a tap asks Mia. */
export interface NoteText {
  readonly titulo: string;
  readonly texto: string;
  readonly pergunta: string;
}

export const watchText = (n: WatchNews): NoteText => {
  const store = bankText(n.description);
  if (n.kind === "repetida")
    return {
      titulo: "Cobrança repetida",
      texto: `${store} cobrou ${money(n.amount)} ${times(n.dates.length)} no ${n.card}, em ${daysText(n.dates)}. Se foi uma compra só, conteste no banco.`,
      pergunta: `O que eu faço com a cobrança repetida de ${store}?`,
    };
  if (n.dispute)
    return {
      titulo: "Contestação",
      texto: `O banco devolveu ${money(n.amount)} de uma contestação no ${n.card}, em ${day(n.date)}.`,
      pergunta: `O que muda na fatura do ${n.card} com a contestação devolvida?`,
    };
  return {
    titulo: "Estorno",
    texto: `${store} devolveu ${money(n.amount)} no ${n.card}, em ${day(n.date)}.`,
    pergunta: `O que muda na fatura do ${n.card} com o estorno de ${store}?`,
  };
};

export const subscriptionText = (n: SubscriptionNews): NoteText => {
  const store = bankText(n.description);
  if (n.kind === "cobrou")
    return {
      titulo: "Cobrou de novo",
      texto: `${store} cobrou ${money(n.amount)} no ${n.card} em ${day(n.date)}, depois que você marcou para cancelar.`,
      pergunta: `${store} cobrou de novo depois que marquei para cancelar. O que eu faço?`,
    };
  return n.kind === "nova"
    ? {
        titulo: "Assinatura nova",
        texto: `${store} cobrou ${money(n.amount)} no ${n.card} em ${daysText([n.since, n.date])}. Não reconhece? Conteste no banco.`,
        pergunta: `O que eu faço com a assinatura nova de ${store}?`,
      }
    : {
        titulo: "Assinatura mais cara",
        texto: `${store} passou de ${money(n.before ?? n.amount)} para ${money(n.amount)} por mês no ${n.card}.`,
        pergunta: `Quanto a alta de ${store} pesa no mês?`,
      };
};

/** Her answer's first line, plain: no bold marks, no list mark. */
export const firstLine = (r: Mia2Rotina): string => {
  const first = r.partes.find((p) => p.t === "mensagem");
  if (first?.t !== "mensagem") return "";
  return (
    first.texto
      .split("\n")
      .map((s) =>
        s
          .replace(/\*\*/g, "")
          .replace(/^\s*(?:[-*•]|\d+\.)\s+/, "")
          .trim(),
      )
      .find(Boolean) ?? ""
  );
};

/** A sentence for a notification or the line: long ones end in "…". */
export const clip = (s: string, max = 160) =>
  s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;

export interface NoteInput {
  readonly watch: readonly WatchNews[];
  readonly subscriptions: readonly SubscriptionNews[];
  /** Her latest routine while it is news (routines.ts `loadRoutine`). */
  readonly rotina: Mia2Rotina | null;
  /** Ids already tapped or dismissed. */
  readonly seen: readonly string[];
  /** Mia 2 can answer: a tap asks her; without her, it opens Faturas. */
  readonly mia: boolean;
}

/**
 * The one line Hoje shows, or null: a charge that came twice first, then a subscription out of
 * its pattern, then money a card gave back (newest first in each), then her routine. What was
 * tapped or dismissed does not come back.
 */
export const miaNote = (i: NoteInput): MiaNote | null => {
  const finding = (key: string, t: NoteText): MiaNote => ({
    id: `vigia:${key}`,
    tipo: "vigia",
    titulo: t.titulo,
    texto: t.texto,
    pergunta: i.mia ? t.pergunta : null,
    abre: i.mia ? "mia" : "faturas",
  });
  const newest = <T extends { readonly date: string }>(xs: readonly T[]) =>
    xs.toSorted((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const line = i.rotina ? clip(firstLine(i.rotina)) : "";
  const all: MiaNote[] = [
    ...newest(i.watch.filter((n) => n.kind === "repetida")).map((n) =>
      finding(n.key, watchText(n)),
    ),
    ...newest(i.subscriptions).map((n) => finding(n.key, subscriptionText(n))),
    ...newest(i.watch.filter((n) => n.kind === "estorno")).map((n) => finding(n.key, watchText(n))),
    ...(i.rotina && line
      ? [
          {
            id: `rotina:${i.rotina.id}`,
            tipo: "rotina",
            titulo: i.rotina.titulo,
            texto: line,
            pergunta: null,
            abre: "mia",
          } satisfies MiaNote,
        ]
      : []),
  ];
  const seen = new Set(i.seen);
  return all.find((n) => !seen.has(n.id)) ?? null;
};
