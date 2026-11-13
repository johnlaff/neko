import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import { Fragment, type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import type {
  Mia2Grafico,
  Mia2Line,
  Mia2Numero,
  Mia2Rotina,
  Mia2Valor,
  Mia2Veredito,
} from "../shared/types.ts";
import { ApiError, api } from "./api.ts";
import { BrandMark } from "./BrandMark.tsx";
import { HIDDEN_MONEY, money, monthName, shortDate } from "./format.ts";
import { IconAlert, IconCheck, IconChevron, IconChevronLeft, IconClose } from "./icons.tsx";
import {
  type MiaTopic,
  miaTitle,
  miaWaiting,
  refocusOpener,
  ScreenLink,
  useKeyboardResizes,
  useMiaStatus,
  useSeconds,
} from "./Mia.tsx";
import { MiaChart } from "./MiaChart.tsx";
import { paceCut, paceStep, WORD_FADE_MS } from "./miaPace.ts";
import { useValuesHidden } from "./privacy.ts";
import { mixNumber, useMorph } from "./useMorph.ts";

/** Questions that show what she does now: sums, charts, the future as a simulation. */
/** What a purchase's answer already says: not suggested after one. */
const ROOM = "Quanto ainda cabe este mês?";
const MIA2_TOPICS: Record<MiaTopic, readonly string[]> = {
  hoje: [ROOM, "Como foram meus últimos 6 meses?"],
  faturas: ["Quanto vem nas próximas faturas?", "Mostra as faturas dos próximos meses"],
  mes: ["Este mês está melhor que o anterior?", "Quanto gastei com mercado este ano?"],
};
/**
 * A question the owner finishes: the chip puts its start in the field, the cursor after it, for
 * what, how much and in how many times. Mia checks it against the teto (posso_comprar).
 */
export const MIA2_FILL = "Posso comprar…?";
export const MIA2_FILL_TEXT = "Posso comprar ";
/** Over the field while a purchase is being written: what she needs to answer it. */
export const MIA2_FILL_HINT =
  "O quê, quanto e como paga. Ex.: uma geladeira de R$\u00a03.000 no Pix ou em 5x";
/** After "Não cabe" at once: the same purchase in parcels, how many finished in the field too. */
export const MIA2_PARCEL = "E se eu parcelar…?";
const PARCEL_TEXT = "E se eu parcelar em ";
/** What the method asks before parcels: in how many, and how long the thing lasts. */
const PARCEL_HINT = "e quanto tempo dura. Ex.: em 5x, dura uns 8 anos.";
/**
 * Questions finished in the field: the chip puts their start there, the cursor after it, and the
 * line over the field says what to write until it is sent.
 */
const FILLS: Readonly<Record<string, { readonly text: string; readonly hint: string }>> = {
  [MIA2_FILL]: { text: MIA2_FILL_TEXT, hint: MIA2_FILL_HINT },
  [MIA2_PARCEL]: { text: PARCEL_TEXT, hint: `Em quantas vezes, ${PARCEL_HINT}` },
};

export const mia2Starters = (topic: MiaTopic = "hoje") =>
  [...MIA2_TOPICS[topic], MIA2_FILL, ...Object.values(MIA2_TOPICS).flat()]
    .filter((q, i, all) => all.indexOf(q) === i)
    .slice(0, 4);

/** A question as asked, whatever its case or closing mark, so a typed one is not suggested again. */
const same = (q: string) => q.toLowerCase().replace(/[\s?!.…]+$/, "");
const notAsked = (asked: readonly string[]) => (q: string) =>
  !asked.some((a) =>
    q === MIA2_FILL ? same(a).startsWith(same(MIA2_FILL_TEXT)) : same(a) === same(q),
  );
/** The field holds a question's start ("Posso comprar") and not yet the rest: nothing to send. */
const onlyStem = (typed: string) => Object.values(FILLS).some((f) => same(typed) === same(f.text));
/** The question being finished: its hint stays until it is sent, so nothing jumps. */
const fillOf = (typed: string) =>
  Object.values(FILLS).find((f) => same(typed).startsWith(same(f.text)));

/** After her routine, what one asks next about that week or that month. */
const ROUTINE_NEXT: Record<Mia2Rotina["tipo"], readonly string[]> = {
  semana: ["Quanto vem nas próximas faturas?", "Este mês está melhor que o anterior?"],
  mes: ["Como guardo mais este mês?", "Quais foram as maiores saídas do mês passado?"],
};

/**
 * What to ask after a purchase checked. On the card: Pix first (the method's way), then in one
 * parcel. After "Não cabe" at once, the method's next step: parcel it, if it lasts (she asks in how
 * many times and what it is), and how to set more aside.
 */
const purchaseNext = (v: Purchase): string[] => {
  if (v.veredito === "nao_cabe")
    return [...(v.parcelas === 1 ? [MIA2_PARCEL] : []), "Como guardo mais este mês?"];
  if (v.meio === "pix") return [];
  return ["E no Pix?", ...(v.parcelas > 1 ? ["E em 1x no cartão?"] : [])];
};

/**
 * After an answer, two questions not asked yet; after her routine, about its week or month first.
 * After a purchase: that purchase another way, or another purchase, never what its answer said.
 */
const mia2Next = (
  asked: readonly string[],
  topic: MiaTopic,
  rotina?: Mia2Rotina["tipo"],
  compra?: Purchase,
) => {
  const after = compra ? [...purchaseNext(compra), MIA2_FILL] : [];
  return (rotina ? ROUTINE_NEXT[rotina] : [])
    .concat(after, mia2Starters(topic), Object.values(MIA2_TOPICS).flat())
    .filter((q, i, all) => all.indexOf(q) === i)
    .filter((q) => after.includes(q) || (notAsked(asked)(q) && !(compra && q === ROOM)))
    .slice(0, 2);
};

type Part =
  | {
      readonly k: "texto";
      readonly id: string;
      readonly texto: string;
      /** Null while the text is still coming: its values are not checked yet. */
      readonly valores: Readonly<Record<string, Mia2Valor>> | null;
    }
  | { readonly k: "grafico"; readonly id: string; readonly grafico: Mia2Grafico }
  | { readonly k: "numeros"; readonly id: string; readonly numeros: readonly Mia2Numero[] }
  | ({ readonly k: "veredito"; readonly id: string } & Purchase);

/** A purchase the Neko checked for "Posso comprar?", and its verdict. */
interface Purchase {
  readonly veredito: Mia2Veredito;
  readonly valor: number;
  readonly parcelas: number;
  readonly meio: "cartao" | "pix";
  /** The card it went on, the main one when she was not told. */
  readonly cartao?: string | null | undefined;
  /** Split, the months it lasts, as said or as she guessed: it can turn Cabe into Aperta. */
  readonly dura?: number | null | undefined;
}

interface Turn {
  readonly n: number;
  /** The owner's question, or the name of her routine. */
  readonly pergunta: string;
  /** Hers, by herself (Sunday's week, the month closed): her routine's name stands for a question. */
  readonly rotina?: Mia2Rotina["tipo"] | undefined;
  readonly parts: readonly Part[];
  /**
   * How it ended, when it did not simply end: stopped, conversation too long, she could not finish
   * (falhou), the connection dropped (rede), or the month's cap (descansa).
   */
  readonly end: "parou" | "cheia" | "falhou" | "rede" | "descansa" | null;
}

/**
 * The conversation with her agent, kept outside the screen like the first Mia's: leaving to check a
 * month and coming back finds it as it was, an answer still coming included.
 */
interface Chat {
  readonly sessao: string | null;
  readonly turns: readonly Turn[];
  /** The question being answered, and since when. */
  readonly pending: { readonly n: number; readonly since: number } | null;
  /** What she is doing, while she is not writing. */
  readonly status: string | null;
  readonly limited: boolean;
  /** The conversation "Nova conversa" just cleared, for Desfazer while it shows. */
  readonly cleared: Chat | null;
}
const EMPTY: Chat = {
  sessao: null,
  turns: [],
  pending: null,
  status: null,
  limited: false,
  cleared: null,
};
let chat: Chat = EMPTY;
const listeners = new Set<() => void>();
const setChat = (next: Partial<Chat>) => {
  chat = { ...chat, ...next };
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const useChat = () => useSyncExternalStore(subscribe, () => chat);
/** Whether a conversation is open, for "Continuar a conversa" on the way in. */
export const useMia2Open = () => useChat().turns.length > 0;

let reading: AbortController | null = null;

const patch = (n: number, fn: (t: Turn) => Turn) =>
  setChat({ turns: chat.turns.map((t) => (t.n === n ? fn(t) : t)) });

const putText = (
  t: Turn,
  id: string,
  texto: string,
  valores: Readonly<Record<string, Mia2Valor>> | null,
): Turn => {
  const at = t.parts.findIndex((p) => p.k === "texto" && p.id === id);
  const part: Part = { k: "texto", id, texto, valores };
  return at < 0
    ? { ...t, parts: [...t.parts, part] }
    : { ...t, parts: t.parts.map((p, i) => (i === at ? part : p)) };
};

/**
 * Her texts and boards already shown in full, by turn and piece: they never come word by word
 * again, not after Desfazer nor coming back to the screen. A new conversation, or a question asked
 * again in its place, starts them over.
 */
const seenParts = new Set<string>();

const ask = async (pergunta: string, onLimit: () => void) => {
  if (chat.pending) return;
  const n = (chat.turns.at(-1)?.n ?? -1) + 1;
  for (const k of seenParts)
    if (chat.turns.length === 0 || k.startsWith(`${n}:`)) seenParts.delete(k);
  const controller = new AbortController();
  reading = controller;
  setChat({
    turns: [...chat.turns, { n, pergunta, parts: [], end: null }],
    pending: { n, since: Date.now() },
    status: null,
    cleared: null,
  });
  let ended = false;
  let monthLimit = false;
  /** She said she could not finish, so the connection was fine. */
  let herFailure = false;
  const line = (l: Mia2Line) => {
    switch (l.t) {
      case "sessao":
        return setChat({ sessao: l.id });
      case "status":
        return setChat({ status: l.texto });
      case "parcial":
        setChat({ status: null });
        return patch(n, (t) => putText(t, l.id, l.texto, null));
      case "mensagem":
        setChat({ status: null });
        return patch(n, (t) => putText(t, l.id, l.texto, l.valores));
      case "grafico":
        setChat({ status: null });
        return patch(n, (t) => ({
          ...t,
          parts: [...t.parts, { k: "grafico", id: l.id, grafico: l.grafico }],
        }));
      case "numeros":
        setChat({ status: null });
        return patch(n, (t) => ({
          ...t,
          parts: [...t.parts, { k: "numeros", id: l.id, numeros: l.numeros }],
        }));
      case "veredito":
        setChat({ status: null });
        return patch(n, (t) => ({
          ...t,
          parts: [
            ...t.parts,
            {
              k: "veredito",
              id: l.id,
              veredito: l.veredito,
              valor: l.valor,
              parcelas: l.parcelas,
              meio: l.meio,
              cartao: l.cartao,
              dura: l.dura,
            },
          ],
        }));
      case "refazendo":
        return patch(n, (t) => ({ ...t, parts: [] }));
      case "fim":
        ended = true;
        return;
      case "erro":
        ended = true;
        if (l.motivo === "limite_conversa") return patch(n, (t) => ({ ...t, end: "cheia" }));
        // The month's cap: she rests, and the question goes with the answer she could not give.
        if (l.motivo === "limite_mes") monthLimit = true;
        else herFailure = true;
        throw new Error(l.motivo);
    }
  };
  try {
    await api.askMia2({ pergunta, sessao: chat.sessao ?? undefined }, line, controller.signal);
    if (!ended) throw new Error("cortada");
    setChat({ pending: null, status: null });
  } catch (e) {
    if (controller.signal.aborted) return;
    if (monthLimit || (e instanceof ApiError && e.status === 429)) {
      onLimit();
      // The question stays, to be asked again when she is back.
      patch(n, (t) => ({ ...t, parts: [], end: "descansa" }));
      return setChat({ pending: null, status: null, limited: true });
    }
    // The question stays where it was asked, with "Tentar de novo" under it; a half answer goes.
    patch(n, (t) => ({ ...t, parts: [], end: herFailure ? "falhou" : "rede" }));
    setChat({ pending: null, status: null });
  } finally {
    if (reading === controller) reading = null;
  }
};

/** Stops her answer: what she wrote stays, marked as stopped. */
const stop = () => {
  const p = chat.pending;
  if (!p) return;
  reading?.abort();
  if (chat.sessao) void api.stopMia2(chat.sessao).catch(() => undefined);
  patch(p.n, (t) => ({ ...t, end: "parou" }));
  setChat({ pending: null, status: null });
};

/** Asks again, in its place, a question that got no answer or whose answer was stopped. */
const retry = (onLimit: () => void) => {
  const t = chat.turns.at(-1);
  if (!t || !(t.end === "falhou" || t.end === "rede" || t.end === "parou") || chat.pending) return;
  setChat({ turns: chat.turns.slice(0, -1) });
  void ask(t.pergunta, onLimit);
};

const restart = () => {
  if (chat.pending) stop();
  setChat({ ...EMPTY, limited: chat.limited, cleared: chat.turns.length > 0 ? chat : null });
};

/**
 * Brings back the conversation "Nova conversa" or her routine cleared. A swap: the one on screen
 * goes to Desfazer in its turn, so a routine undone is not lost (it was already marked seen).
 */
const undoRestart = () => {
  if (!chat.cleared || chat.pending) return;
  setChat({ ...chat.cleared, cleared: chat.turns.length > 0 ? { ...chat, cleared: null } : null });
};
const ROUTINE_SEEN = "neko.mia2.rotina";
const routineSeen = (id: string) => {
  try {
    return localStorage.getItem(ROUTINE_SEEN) === id;
  } catch {
    return false;
  }
};

/**
 * Her routine, the first time her screen opens after it came: it becomes the conversation (one
 * that was open goes to Desfazer, as with "Nova conversa") and the next question goes on in it.
 */
const takeRoutine = (r: Mia2Rotina) => {
  if (chat.pending || routineSeen(r.id)) return;
  try {
    localStorage.setItem(ROUTINE_SEEN, r.id);
  } catch {
    // Without storage it shows again next time, which is harmless.
  }
  const parts = r.partes.map(
    (p): Part =>
      p.t === "mensagem"
        ? { k: "texto", id: p.id, texto: p.texto, valores: p.valores }
        : p.t === "grafico"
          ? { k: "grafico", id: p.id, grafico: p.grafico }
          : { k: "numeros", id: p.id, numeros: p.numeros },
  );
  setChat({
    ...EMPTY,
    limited: chat.limited,
    sessao: r.sessao,
    turns: [{ n: 0, pergunta: r.titulo, rotina: r.tipo, parts, end: null }],
    cleared: chat.turns.length > 0 ? chat : null,
  });
};

/** How long Desfazer stays after "Nova conversa", as after a launch. */
const UNDO_MS = 10_000;

/** Values in reais keep their place but say nothing while values are hidden. */
const Value = ({
  texto,
  v,
  hidden,
  note,
}: {
  texto: string;
  v: Mia2Valor | undefined;
  hidden: boolean;
  /** The note under the text that says this value came from nowhere. */
  note?: string | undefined;
}) => {
  const shown = hidden ? HIDDEN_MONEY : texto;
  if (!v) return <span className="mia-value">{shown}</span>;
  const where =
    v.tela === "faturas"
      ? "ver faturas"
      : v.mes
        ? `ver ${monthName(Number(v.mes.slice(5, 7)))}`
        : "ver o mês";
  if (!v.conferido)
    return (
      <span className="mia-value unchecked" aria-describedby={note}>
        {shown}
      </span>
    );
  // Hoje is where she is opened from; a simulation is not kept anywhere to go back to.
  if (v.tela === "faturas" || v.tela === "mes")
    return (
      <ScreenLink
        v={{ tela: v.tela, mes: v.mes }}
        className="mia-value"
        title={`${shown} · ${where}`}
      >
        {shown}
      </ScreenLink>
    );
  return <span className="mia-value">{shown}</span>;
};

const NOT_CHECKED: Mia2Valor = { conferido: false };

/** Words of a piece of her text as it arrives, each keyed by where it starts in the line. */
const words = (s: string, from: number): ReactNode[] => {
  let at = from;
  return s.split(/(\s+)/).map((w) => {
    const k = at;
    at += w.length;
    return w === "" || /^\s+$/.test(w) ? (
      w
    ) : (
      <span key={`w${k}`} className="mia-w">
        {w}
      </span>
    );
  });
};

const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One line of her text: **bold**, and each R$ value as she wrote it, checked or not. */
const Inline = ({
  text,
  valores,
  hidden,
  note,
  stopped,
  fade,
}: {
  text: string;
  valores: Readonly<Record<string, Mia2Valor>> | null;
  hidden: boolean;
  note?: string | undefined;
  /** The text of an answer stopped before the check: its values carry the unchecked mark. */
  stopped: boolean;
  /** Still arriving: each word is its own piece, fading in as it comes. */
  fade: boolean;
}) => {
  const keys = Object.keys(valores ?? {}).sort((a, b) => b.length - a.length);
  // While the text is still coming, any R$ is plain (and hidden when values are). Like the checked
  // keys, it takes no space before it, so a value keeps its place when it is checked.
  const money =
    keys.length > 0
      ? new RegExp(`(${keys.map(literal).join("|")})`, "g")
      : /((?:[−-]\s?)?R\$\s?[−-]?\s?[\d.,]*\d)/g;
  // A word keeps its place (its key) as more words come after it, so only new words fade in.
  let at = 0;
  const pieces = (s: string, bold: boolean, key: string): ReactNode[] =>
    s.split(money).map((piece, i) => {
      const k = `${key}-${i}`;
      const from = at;
      at += piece.length;
      if (i % 2 === 0) return <Fragment key={k}>{fade ? words(piece, from) : piece}</Fragment>;
      const v = valores?.[piece] ?? (stopped ? NOT_CHECKED : undefined);
      const node = <Value key={k} texto={piece} v={v} hidden={hidden} note={note} />;
      const value = bold ? <strong key={k}>{node}</strong> : node;
      return fade ? (
        <span key={`v${from}`} className="mia-w">
          {value}
        </span>
      ) : (
        value
      );
    });
  return (
    <>
      {text.split(/\*\*(.+?)\*\*/g).flatMap((seg, i): ReactNode[] => {
        const key = `${i}`;
        return i % 2 === 1
          ? [<strong key={key}>{pieces(seg, false, key)}</strong>]
          : pieces(seg, false, key);
      })}
    </>
  );
};

/** Her text in short paragraphs and lists, nothing richer: no headings, no tables, no HTML. */
const Rich = ({
  texto,
  valores,
  hidden,
  lead,
  note,
  stopped,
  fade,
}: {
  texto: string;
  valores: Readonly<Record<string, Mia2Valor>> | null;
  hidden: boolean;
  /** Her first paragraph is the answer: set like every Neko verdict. */
  lead: boolean;
  note?: string | undefined;
  stopped: boolean;
  fade: boolean;
}) => {
  const blocks: { list: boolean; lines: string[] }[] = [];
  // A bold still being written shows plain until it closes.
  const whole =
    (texto.match(/\*\*/g)?.length ?? 0) % 2 === 1 ? texto.replace(/\*\*(?!.*\*\*)/s, "") : texto;
  for (const raw of whole.split("\n")) {
    const line = raw.trim().replace(/^#+\s*/, "");
    const open = blocks.at(-1);
    if (!line) {
      if (open?.lines.length) blocks.push({ list: false, lines: [] });
      continue;
    }
    const item = /^([-•*]|\d+[.)])\s+/.exec(line);
    const text = item ? line.slice(item[0].length) : line;
    if (open && open.lines.length === 0) {
      open.list = Boolean(item);
      open.lines.push(text);
    } else if (open && open.list === Boolean(item)) open.lines.push(text);
    else blocks.push({ list: Boolean(item), lines: [text] });
  }
  return (
    <div className="mia-rich">
      {blocks
        .filter((b) => b.lines.length > 0)
        .map((b, i) =>
          b.list ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: blocks of one finished text, in order
            <ul key={i}>
              {b.lines.map((l, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: lines of one block, in order
                <li key={j}>
                  <Inline
                    text={l}
                    valores={valores}
                    hidden={hidden}
                    note={note}
                    stopped={stopped}
                    fade={fade}
                  />
                </li>
              ))}
            </ul>
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: blocks of one finished text, in order
            <p key={i} className={lead && i === 0 ? "lead" : undefined}>
              {b.lines.map((l, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: lines of one block, in order
                <Fragment key={j}>
                  {j > 0 && <br />}
                  <Inline
                    text={l}
                    valores={valores}
                    hidden={hidden}
                    note={note}
                    stopped={stopped}
                    fade={fade}
                  />
                </Fragment>
              ))}
            </p>
          ),
        )}
    </div>
  );
};

/** The last purchase an answer checked. */
const verdictIn = (t: Turn | undefined) =>
  t?.parts.findLast((p): p is Extract<Part, { k: "veredito" }> => p.k === "veredito");

/**
 * The purchase to ask next about: the last answer's, or, after a follow-up that failed or was
 * stopped, the one before it, so its ways on are not lost.
 */
const lastPurchase = (turns: readonly Turn[]) => {
  for (const t of [...turns].reverse()) {
    const v = verdictIn(t);
    if (v || (t.end !== "falhou" && t.end !== "rede" && t.end !== "parou")) return v;
  }
  return undefined;
};

/** The line over the field; splitting a purchase names it, so the question keeps its context. */
const hintFor = (
  fill: { readonly text: string; readonly hint: string },
  compra: Purchase | undefined,
  hidden: boolean,
) => {
  if (fill.text !== PARCEL_TEXT || !compra) return fill.hint;
  const value = hidden ? HIDDEN_MONEY : money(Math.round(compra.valor * 100));
  return `Em quantas vezes os ${value} no ${compra.cartao || "cartão"}, ${PARCEL_HINT}`;
};

/** The screens an answer's checked values came from, two at most, as quiet ways out. */
const sourcesOf = (t: Turn) => {
  const seen = new Map<
    string,
    { key: string; tela: "faturas" | "mes"; mes?: string | undefined; label: string }
  >();
  for (const p of t.parts) {
    const values =
      p.k === "texto" ? Object.values(p.valores ?? {}) : p.k === "numeros" ? p.numeros : [];
    for (const v of values.map((x) => ({ conferido: true, ...x }))) {
      if (!v.conferido || (v.tela !== "faturas" && v.tela !== "mes")) continue;
      const key = `${v.tela}:${v.mes ?? ""}`;
      if (seen.has(key)) continue;
      const label =
        v.tela === "faturas"
          ? "Ver faturas"
          : v.mes
            ? `Ver ${monthName(Number(v.mes.slice(5, 7)))}`
            : "Ver o mês";
      seen.set(key, { key, tela: v.tela, mes: v.mes, label });
    }
  }
  return [...seen.values()].slice(0, 2);
};

const MONEY = /[−-]?\s?R\$\s?[−-]?\s?[\d.,]*\d/;

/** The values of one piece of her text that came from nowhere. */
const unchecked = (p: Part) =>
  p.k === "texto"
    ? Object.entries(p.valores ?? {}).flatMap(([k, v]) => (v.conferido ? [] : [k]))
    : [];

/** Whether a stopped answer has values she never got to check. */
const stoppedValues = (t: Turn) =>
  t.end === "parou" &&
  t.parts.some((p) => p.k === "texto" && p.valores === null && MONEY.test(p.texto));

/**
 * A number of her board, counting up from zero as it arrives, as the Neko's figures do (an answer
 * already read shows still). Plain, not a link: where it came from is in the ways out under it.
 */
const Figure = ({ x, count, hidden }: { x: Mia2Numero; count: boolean; hidden: boolean }) => {
  const cents = Math.round(x.valor * 100);
  const { from, to, e } = useMorph(cents, String(cents), mixNumber, count ? 0 : undefined);
  // Hidden, a value says nothing, not even its sign. A screen reader hears the value, never the count.
  return (
    <div>
      <dt>{x.rotulo}</dt>
      <dd className={cents < 0 && !hidden ? "neg" : undefined}>
        {hidden ? (
          HIDDEN_MONEY
        ) : (
          <>
            <span aria-hidden="true">{money(Math.round(mixNumber(from, to, e)))}</span>
            <span className="sr-only">{money(cents)}</span>
          </>
        )}
      </dd>
      {x.nota && <dd className="fig-note">{x.nota}</dd>}
    </div>
  );
};

/** Her board: two to four numbers side by side, a short label over each, every one checked. */
const Board = ({
  id,
  numeros,
  count,
  hidden,
}: {
  id: string;
  numeros: readonly Mia2Numero[];
  count: boolean;
  hidden: boolean;
}) => {
  useEffect(() => {
    seenParts.add(id);
  }, [id]);
  return (
    <dl className="figures mia-numbers">
      {numeros.map((x, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: one board, in the order she gave
        <Figure key={i} x={x} count={count} hidden={hidden} />
      ))}
    </dl>
  );
};

/** Her texts still showing word by word: what comes after an answer waits for them. */
const moving = new Set<string>();
const movers = new Set<() => void>();
let moved = 0;
const move = (key: string, on: boolean) => {
  if (on === moving.has(key)) return;
  if (on) moving.add(key);
  else moving.delete(key);
  moved++;
  for (const f of movers) f();
};
/** Renders again whenever a text starts or stops moving; `moving` then says which. */
const useMoving = () =>
  useSyncExternalStore(
    (f) => {
      movers.add(f);
      return () => movers.delete(f);
    },
    () => moved,
  );

/**
 * Her text at reading pace: as it arrives, whole words show at a steady flow and fade in
 * (miaPace.ts). `paced` false shows it all at once: an answer already read, a stopped one, or
 * when the system asks for less motion. `fading` stays on until the last word has faded in.
 */
const usePaced = (key: string, texto: string, done: boolean, paced: boolean) => {
  const [shown, setShown] = useState(paced ? 0 : texto.length);
  const [fading, setFading] = useState(paced);
  const pos = useRef(0);
  useEffect(() => {
    if (!paced) return setShown(texto.length);
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
      last = now;
      pos.current = paceStep(pos.current, texto.length, dt);
      setShown(paceCut(texto, pos.current, done));
      if (pos.current < texto.length) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [texto, done, paced]);
  const settled = !paced || (done && shown >= texto.length);
  useEffect(() => {
    if (!settled) {
      move(key, true);
      return setFading(true);
    }
    // What comes after (a chart, a note, the ways out) waits for the last word to fade in, so it
    // lands once, all together, and nothing moves under the thumb after.
    const timer = setTimeout(
      () => {
        if (paced) seenParts.add(key);
        setFading(false);
        move(key, false);
      },
      paced ? WORD_FADE_MS : 0,
    );
    return () => clearTimeout(timer);
  }, [key, settled, paced]);
  useEffect(() => () => move(key, false), [key]);
  return { shown: paced ? shown : texto.length, fading: fading && paced };
};

const lessMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/** A mouse or a trackpad: no on-screen keyboard to open or to cover her answer. */
const atDesk = () => window.matchMedia("(pointer: fine)").matches;

/** One text of hers, shown at reading pace; what goes under it waits until it is all there. */
const PacedText = ({
  id,
  texto,
  done,
  paced,
  children,
  ...rich
}: {
  id: string;
  texto: string;
  done: boolean;
  paced: boolean;
  children: ReactNode;
} & Omit<Parameters<typeof Rich>[0], "texto" | "fade">) => {
  const { shown, fading } = usePaced(id, texto, done, paced);
  return (
    <>
      <Rich texto={texto.slice(0, shown)} fade={fading} {...rich} />
      {!fading && children}
    </>
  );
};

/**
 * Reached with Tab, a chip half in the row's fade slides into full view. Only its row moves:
 * scrollIntoView would also scroll the page, which keeps fields clear of the dock.
 */
const revealChip = (chip: HTMLElement) => {
  const row = chip.parentElement;
  if (!row) return;
  const c = chip.getBoundingClientRect();
  const r = row.getBoundingClientRect();
  const fade = r.width * 0.15;
  if (c.right > r.right - fade) row.scrollLeft += c.right - r.right + fade;
  else if (c.left < r.left) row.scrollLeft -= r.left - c.left + 4;
};

/** A suggested question: sent on a tap, or, for "Posso comprar…?", started in the field. */
const Suggestion = ({ q, pick }: { q: string; pick: (q: string) => void }) => (
  <button
    type="button"
    className="chip-button"
    onClick={() => pick(q)}
    onFocus={(e) => revealChip(e.currentTarget)}
    aria-describedby={q in FILLS ? "mia-fill-chip" : undefined}
  >
    {q}
  </button>
);

const VERDICT = {
  cabe: { word: "Cabe", tone: "pos", icon: <IconCheck /> },
  aperta: { word: "Aperta", tone: "warn", icon: <IconAlert /> },
  nao_cabe: { word: "Não cabe", tone: "neg", icon: <IconClose /> },
} as const;

/** How long it lasts, in the words of the parcel hint; never rounded, so it reads as checked. */
const lasts = (months: number) => {
  if (months === 0) return "se consome logo";
  if (months === 1) return "dura um mês";
  if (months % 12 !== 0) return `dura uns ${months} meses`;
  return months === 12 ? "dura um ano" : `dura uns ${months / 12} anos`;
};

/** The purchase as checked, so what she assumed (the main card, at once, how long it lasts) is in sight. */
export const purchaseLabel = (v: Omit<Purchase, "veredito">, hidden: boolean) => {
  const value = hidden ? HIDDEN_MONEY : money(Math.round(v.valor * 100));
  if (v.meio === "pix") return `${value} no Pix`;
  const card = v.cartao || "cartão";
  if (v.parcelas === 1) return `${value} à vista no ${card}`;
  const split = `${value} em ${v.parcelas}x no ${card}`;
  return v.dura == null ? split : `${split}, ${lasts(v.dura)}`;
};

/**
 * "Posso comprar?": the Neko's verdict, never her words, in the serif of every verdict here, its
 * tone and an icon so it never rests on color alone; her text under it gives the reason.
 */
const Verdict = ({ v, hidden }: { v: Purchase; hidden: boolean }) => {
  const look = VERDICT[v.veredito];
  return (
    <div className={`mia-verdict ${look.tone}`}>
      <p className="mia-verdict-word">
        {look.icon}
        <span className="sr-only">Veredito do Neko: </span>
        <span>{look.word}</span>
      </p>
      <p className="mia-verdict-what">{purchaseLabel(v, hidden)}</p>
    </div>
  );
};

/** Her answer's pieces, each text followed by the note on its values that came from nowhere. */
const Answer = ({
  t,
  working,
  hidden,
  paced,
}: {
  t: Turn;
  working: boolean;
  hidden: boolean;
  /** Asked here and now: her words come at reading pace (not an answer already read). */
  paced: boolean;
}) => {
  useMoving();
  // Her first paragraph is the answer, in the serif; under the Neko's verdict it is the reason.
  const first = t.parts.some((p) => p.k === "veredito")
    ? undefined
    : t.parts.find((p) => p.k === "texto")?.id;
  const stoppedNote = stoppedValues(t) ? `mia-stopped-${t.n}` : undefined;
  // Her pieces come in order: a chart, or her next text, waits for the words before it.
  const shown = t.parts.findIndex((p) => moving.has(`${t.n}:${p.id}`));
  return t.parts.slice(0, shown < 0 ? undefined : shown + 1).map((p) => {
    if (p.k === "grafico") return <MiaChart key={p.id} grafico={p.grafico} />;
    if (p.k === "veredito") return <Verdict key={p.id} v={p} hidden={hidden} />;
    const id = `${t.n}:${p.id}`;
    if (p.k === "numeros")
      return (
        <Board
          key={p.id}
          id={id}
          numeros={p.numeros}
          count={paced && !seenParts.has(id)}
          hidden={hidden}
        />
      );
    const stopped = t.end === "parou" && p.valores === null;
    // Her values are checked once her text is whole: the note may show then, with what follows.
    const loose = unchecked(p);
    const note = stopped ? stoppedNote : loose.length > 0 ? `mia-note-${t.n}-${p.id}` : undefined;
    return (
      <PacedText
        key={p.id}
        id={id}
        texto={p.texto}
        done={p.valores !== null || !working}
        // Parar keeps what she wrote, all of it, at once; what was shown once stays shown.
        paced={paced && t.end !== "parou" && !seenParts.has(id)}
        valores={p.valores}
        hidden={hidden}
        lead={p.id === first}
        note={note}
        stopped={stopped}
      >
        {loose.length > 0 && (
          <p className="mia-note warn" id={note}>
            {hidden ? (
              loose.length > 1 ? (
                "Alguns valores não estão"
              ) : (
                "Um valor não está"
              )
            ) : (
              <>
                {loose.map((v, i) => (
                  <Fragment key={v}>
                    {i > 0 && ", "}
                    <span className="mia-value unchecked">{v}</span>
                  </Fragment>
                ))}
                {loose.length > 1 ? " não estão" : " não está"}
              </>
            )}{" "}
            nos números do Neko. Confira antes de usar.
          </p>
        )}
      </PacedText>
    );
  });
};

const smooth = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

/**
 * Mia 2's screen: the same page as the first Mia's, her answer written as it comes, charts in the
 * conversation, every R$ checked against the Neko's numbers and a stop while she works.
 */
export const Mia2Screen = ({ topic = "hoje" }: { topic?: MiaTopic | undefined }) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  const router = useRouter();
  const status = useMiaStatus();
  const hidden = useValuesHidden();
  const { turns, pending, limited, status: doing, cleared } = useChat();
  const [typed, setTyped] = useState("");
  /** A question typed and sent while she answers: it goes when she is done. */
  const [held, setHeld] = useState(false);
  /** Said to a screen reader when an answer ends while the owner is typing the next question. */
  const [told, setTold] = useState("");
  const last = useRef<HTMLLIElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const seconds = useSeconds(pending?.since);
  /** Questions asked while the screen is open: only their answers move; the rest were read. */
  const [here] = useState(() => new Set<number>());
  if (pending) here.add(pending.n);
  const [still] = useState(lessMotion);
  const routine = useQuery({
    queryKey: ["mia2-rotina"],
    queryFn: api.mia2Rotina,
    staleTime: 60_000,
    enabled: status.data?.versao === 2,
  });
  useEffect(() => {
    if (routine.data?.rotina) takeRoutine(routine.data.rotina);
  }, [routine.data]);
  useMoving();
  const showing = moving.size > 0;
  useKeyboardResizes();
  useEffect(() => {
    if (chat.turns.length === 0 && !atDesk()) title.current?.focus({ preventScroll: true });
    return () => {
      refocusOpener();
    };
  }, []);
  // A question just sent goes to the top, under the bar; the answer then grows under it in the room
  // kept for it, never scrolled away. A starter tapped is gone: the focus waits on the page.
  useEffect(() => {
    if (!pending) return;
    last.current?.scrollIntoView({ block: "start", behavior: smooth() });
    if (document.activeElement === document.body)
      (atDesk() ? input.current : body.current)?.focus({ preventScroll: true });
  }, [pending]);
  const typedNow = useRef(typed);
  typedNow.current = typed;
  const heldNow = useRef(held);
  heldNow.current = held;
  // A finished answer, all on screen (her last words shown, not only arrived), takes the focus to
  // be read, where it is (no jump), while the owner is still here. Typing the next question, or just
  // after Parar, the field keeps it (the keyboard stays up): the answer is announced instead, and a
  // question sent while she answered goes now, so it rises under the bar with nothing landing above.
  const finished = pending === null && !showing ? turns.length : -1;
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per finished answer
  useEffect(() => {
    if (finished <= 0) return;
    const here = document.activeElement;
    const end = chat.turns.at(-1)?.end ?? null;
    // Said aloud when the focus stays in the field: that she answered, and the Neko's verdict.
    const v = end === null ? verdictIn(chat.turns.at(-1)) : undefined;
    const answered = `A Mia respondeu.${v ? ` ${VERDICT[v.veredito].word}: ${purchaseLabel(v, hidden)}.` : ""}`;
    if (heldNow.current) {
      setHeld(false);
      if (end === null && typedNow.current.trim()) {
        send(typedNow.current);
        return setTold(`${answered} Sua próxima pergunta foi enviada.`);
      }
    }
    if (here === input.current && (typedNow.current || end === "parou")) {
      setTold(end === null ? answered : "");
      return;
    }
    const ours = here === document.body || here === input.current || here === title.current;
    // At a desk there is no keyboard to close: the field keeps the focus, as in every desktop chat.
    if (atDesk() && input.current && (ours || here === body.current)) {
      setTold(end === null ? answered : "");
      return input.current.focus({ preventScroll: true });
    }
    if (!last.current) return;
    if (!ours && !body.current?.contains(here)) return;
    last.current.focus({ preventScroll: true });
  }, [finished]);
  // Desfazer after "Nova conversa" stays a few seconds, as after a launch.
  useEffect(() => {
    if (!cleared) return;
    const timer = setTimeout(() => setChat({ cleared: null }), UNDO_MS);
    return () => clearTimeout(timer);
  }, [cleared]);
  const back = () => (canGoBack ? router.history.back() : navigate({ to: "/" }));

  const s = status.data;
  const onLimit = () => void queryClient.invalidateQueries({ queryKey: ["mia"] });
  const send = (q: string) => {
    const pergunta = q.trim();
    if (!pergunta || chat.pending) return;
    setTyped("");
    setTold("");
    void ask(pergunta, onLimit);
  };
  // "Posso comprar…?" is finished in the field: focused in the tap itself, so the phone's keyboard
  // opens, and the cursor after the words.
  // The words and the hint are on the page before the focus, so a screen reader says them.
  const pick = (q: string) => {
    const fill = FILLS[q];
    if (!fill) return send(q);
    const field = input.current;
    flushSync(() => setTyped(fill.text));
    // The answer above stays where it was read.
    field?.focus({ preventScroll: true });
    field?.setSelectionRange(fill.text.length, fill.text.length);
  };
  // Parar takes Enviar's place: a second tap on Enviar right after it is not a stop.
  const halt = (tap: boolean) => {
    if (!chat.pending || (tap && Date.now() - chat.pending.since < 600)) return;
    setHeld(false);
    stop();
    input.current?.focus();
  };
  const undo = () => {
    undoRestart();
    input.current?.focus();
  };
  const newChat = () => {
    restart();
    (input.current ?? body.current)?.focus();
  };
  const resting = Boolean(s?.pausadaAte) || limited;
  const asked = turns.map((t) => t.pergunta);
  const starters = mia2Starters(topic).filter(notAsked(asked));
  const full = turns.at(-1)?.end === "cheia";
  const next =
    turns.length === 0 || typed.trim() || pending || showing || resting || full
      ? []
      : mia2Next(asked, topic, turns[0]?.rotina, lastPurchase(turns));
  // A question being finished in the field, and what to write in it.
  const fill = fillOf(typed);
  const hint = fill && hintFor(fill, lastPurchase(turns), hidden);
  const composing = Boolean(s?.ligada && !resting && !full);
  // At a desk the field holds the focus as soon as it is on the page, ready for the first words.
  useEffect(() => {
    if (!atDesk()) return;
    const at = document.activeElement;
    if (at && at !== document.body && at !== title.current) return;
    if (composing) input.current?.focus({ preventScroll: true });
    else if (chat.turns.length === 0) title.current?.focus({ preventScroll: true });
  }, [composing]);

  return (
    <>
      <header className="mia-bar">
        <button
          type="button"
          className="icon"
          onClick={back}
          aria-label="Voltar"
          aria-keyshortcuts="Escape"
          title="Voltar (Esc)"
        >
          <IconChevronLeft />
        </button>
        <h1 ref={title} tabIndex={-1}>
          <BrandMark width={28} className="mia-mark" />
          Mia
        </h1>
        {turns.length > 0 && (
          // Stays put while an answer is on its way, so the bar does not jump; usable again after.
          <button
            type="button"
            className="text-link mia-restart"
            disabled={Boolean(pending)}
            onClick={newChat}
          >
            Nova conversa
          </button>
        )}
      </header>
      <div className="mia-body" ref={body} tabIndex={-1}>
        {s?.pausadaAte && !limited && (
          <p className="muted mia-lead">
            A Mia descansa até {shortDate(s.pausadaAte)}. Os números seguem nas telas.
          </p>
        )}
        {cleared && (
          <div className="toast inline" role="status">
            <span>
              {turns.length === 0
                ? "Conversa apagada"
                : cleared.turns[0]?.rotina
                  ? "Resumo da Mia fechado"
                  : "Conversa anterior apagada"}
            </span>
            <button type="button" className="ghost small" onClick={undo}>
              Desfazer
            </button>
          </div>
        )}
        {turns.length === 0 && !pending && (
          <div className="mia-empty">
            <h2>{miaTitle(topic)}</h2>
            <p className="muted">
              Ela lê o Neko, faz as contas e mostra gráficos. Não muda a planilha. Valores
              sublinhados levam à tela de onde vieram.
            </p>
            {/* Out of sight while a question is typed, as after an answer, so a tap never loses
                it; at a desk they keep their room, so the field never moves. */}
            {!resting && (
              <div className={typed.trim() ? "mia-starters away" : "mia-starters"}>
                {starters.map((q) => (
                  <Suggestion key={q} q={q} pick={pick} />
                ))}
              </div>
            )}
          </div>
        )}
        {turns.length > 0 && (
          <ol className="mia-talk v2" aria-label="Conversa com a Mia">
            {turns.map((t, i) => {
              const newest = i === turns.length - 1;
              const working = pending?.n === t.n;
              const sources = newest && !working && !showing ? sourcesOf(t) : [];
              // What she is doing shines while she does it; while she writes, the dots say more
              // is coming.
              const label = doing ?? (t.parts.length > 0 ? "" : miaWaiting(seconds));
              return (
                <li
                  key={t.n}
                  ref={newest ? last : undefined}
                  tabIndex={newest ? -1 : undefined}
                  className={here.has(t.n) ? "fresh" : undefined}
                >
                  {t.rotina ? (
                    <p className="mia-routine">{t.pergunta}</p>
                  ) : (
                    <p className="mia-q">{t.pergunta}</p>
                  )}
                  <Answer t={t} working={working} hidden={hidden} paced={here.has(t.n) && !still} />
                  {working && (
                    <div className="mia-wait">
                      {!label && <span className="mia-dots" aria-hidden="true" />}
                      <p className={label ? "mia-status shine" : "mia-status"} aria-live="polite">
                        {label}
                      </p>
                    </div>
                  )}
                  {t.end === "parou" && (
                    <div className="mia-wait">
                      <p
                        className="mia-note"
                        id={stoppedValues(t) ? `mia-stopped-${t.n}` : undefined}
                      >
                        {stoppedValues(t)
                          ? "Você parou esta resposta. Os valores não foram conferidos."
                          : "Você parou esta resposta."}
                      </p>
                      {newest && !resting && !pending && (
                        <button
                          type="button"
                          className="text-link mia-retry"
                          onClick={() => retry(onLimit)}
                        >
                          Perguntar de novo
                        </button>
                      )}
                    </div>
                  )}
                  {t.end === "descansa" && (
                    <p className="mia-status" aria-live="polite">
                      A Mia descansa até o mês que vem. Os números seguem nas telas.
                    </p>
                  )}
                  {(t.end === "falhou" || t.end === "rede") && (
                    <div className="mia-wait">
                      <p className="mia-status" aria-live="polite">
                        {t.end === "rede"
                          ? "A Mia não respondeu. Confira a internet e tente de novo."
                          : "A Mia não conseguiu terminar esta resposta. Tente de novo."}
                      </p>
                      {newest && !resting && (
                        <button
                          type="button"
                          className="text-link mia-retry"
                          onClick={() => retry(onLimit)}
                        >
                          Tentar de novo
                        </button>
                      )}
                    </div>
                  )}
                  {t.end === "cheia" && (
                    <div className="mia-wait">
                      <p className="mia-note">
                        Esta conversa ficou longa demais. Comece uma nova para continuar.
                      </p>
                      {newest && (
                        <button type="button" className="text-link mia-retry" onClick={newChat}>
                          Nova conversa
                        </button>
                      )}
                    </div>
                  )}
                  {sources.length > 0 && (
                    <p className="mia-sources">
                      {sources.map((src) => (
                        <ScreenLink key={src.key} v={src} className="mia-source">
                          {src.label}
                          <IconChevron />
                        </ScreenLink>
                      ))}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        <p className="mia-status" aria-live="polite">
          {limited && turns.at(-1)?.end !== "descansa"
            ? "A Mia descansa até o mês que vem. Os números seguem nas telas."
            : ""}
        </p>
        <p className="sr-only" aria-live="polite">
          {told}
        </p>
        <span id="mia-fill-chip" hidden>
          Começa a pergunta no campo
        </span>
      </div>
      {composing && (
        <div className="mia-composer">
          {held && pending && <p className="mia-held">Sua pergunta vai quando ela terminar.</p>}
          {hint && (
            <p className="mia-held" id="mia-fill-hint">
              {hint}
            </p>
          )}
          {next.length > 0 && (
            <div className="mia-suggest" key={turns.length}>
              {next.map((q) => (
                <Suggestion key={q} q={q} pick={pick} />
              ))}
            </div>
          )}
          <form
            className="mia-form"
            onSubmit={(e) => {
              e.preventDefault();
              // While she answers, Enter keeps the next question for when she is done.
              if (onlyStem(typed)) return;
              if (!pending) send(typed);
              else if (typed.trim()) {
                setHeld(true);
                setTold("Sua pergunta vai quando ela terminar.");
              }
            }}
          >
            <input
              ref={input}
              aria-label="Pergunta para a Mia"
              aria-describedby={hint ? "mia-fill-hint" : undefined}
              placeholder={turns.length > 0 ? "Outra pergunta?" : "Pergunte algo"}
              maxLength={1000}
              autoComplete="off"
              enterKeyHint="send"
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value);
                if (!e.target.value.trim()) setHeld(false);
              }}
              onKeyDown={(e) => {
                // Enter on only a question's start: said again, what is missing (Enviar is off).
                if (e.key === "Enter" && onlyStem(typed)) {
                  e.preventDefault();
                  flushSync(() => setTold(""));
                  return setTold(hint ?? "");
                }
                // ↑ in an empty field brings back the last question, to change and send again.
                const lastAsked = turns.at(-1);
                if (e.key === "ArrowUp" && !typed && !pending && lastAsked && !lastAsked.rotina) {
                  e.preventDefault();
                  return setTyped(lastAsked.pergunta);
                }
                if (e.key !== "Escape") return;
                e.preventDefault();
                if (pending) halt(false);
                else if (typed) setTyped("");
                else back();
              }}
            />
            {/* Two elements, not one that changes type: a Parar click that turns it into Enviar
                would otherwise submit the form and send what is in the field. */}
            {pending ? (
              <button
                key="parar"
                type="button"
                className="ghost mia-stop"
                onClick={() => halt(true)}
              >
                Parar
              </button>
            ) : (
              <button key="enviar" type="submit" disabled={!typed.trim() || onlyStem(typed)}>
                Enviar
              </button>
            )}
          </form>
        </div>
      )}
    </>
  );
};
