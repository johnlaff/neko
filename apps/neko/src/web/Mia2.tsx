import { useQueryClient } from "@tanstack/react-query";
import { useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import { Fragment, type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Mia2Grafico, Mia2Line, Mia2Valor } from "../shared/types.ts";
import { ApiError, api } from "./api.ts";
import { BrandMark } from "./BrandMark.tsx";
import { HIDDEN_MONEY, monthName, shortDate } from "./format.ts";
import { IconChevron, IconChevronLeft } from "./icons.tsx";
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
import { useValuesHidden } from "./privacy.ts";

/** Questions that show what she does now: sums, charts, the future as a simulation. */
const MIA2_TOPICS: Record<MiaTopic, readonly string[]> = {
  hoje: ["Quanto ainda cabe este mês?", "Como foram meus últimos 6 meses?"],
  faturas: ["Quanto vem nas próximas faturas?", "Mostra as faturas dos próximos meses"],
  mes: ["Este mês está melhor que o anterior?", "Quanto gastei com mercado este ano?"],
};
const ANY = "E se eu comprar algo de R$ 2.000 em 10x?";

export const mia2Starters = (topic: MiaTopic = "hoje") =>
  [...MIA2_TOPICS[topic], ANY, ...Object.values(MIA2_TOPICS).flat()]
    .filter((q, i, all) => all.indexOf(q) === i)
    .slice(0, 4);

/** A question as asked, whatever its case or closing mark, so a typed one is not suggested again. */
const same = (q: string) => q.toLowerCase().replace(/[\s?!.]+$/, "");
const notAsked = (asked: readonly string[]) => (q: string) =>
  !asked.some((a) => same(a) === same(q));

const mia2Next = (asked: readonly string[], topic: MiaTopic) =>
  mia2Starters(topic)
    .concat(Object.values(MIA2_TOPICS).flat())
    .filter((q, i, all) => all.indexOf(q) === i)
    .filter(notAsked(asked))
    .slice(0, 2);

type Part =
  | {
      readonly k: "texto";
      readonly id: string;
      readonly texto: string;
      /** Null while the text is still coming: its values are not checked yet. */
      readonly valores: Readonly<Record<string, Mia2Valor>> | null;
    }
  | { readonly k: "grafico"; readonly id: string; readonly grafico: Mia2Grafico };

interface Turn {
  readonly n: number;
  readonly pergunta: string;
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

const ask = async (pergunta: string, onLimit: () => void) => {
  if (chat.pending) return;
  const n = (chat.turns.at(-1)?.n ?? -1) + 1;
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

/** Brings back the conversation "Nova conversa" cleared. */
const undoRestart = () => {
  if (chat.cleared && !chat.pending) setChat({ ...chat.cleared, cleared: null });
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

const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One line of her text: **bold**, and each R$ value as she wrote it, checked or not. */
const Inline = ({
  text,
  valores,
  hidden,
  note,
  stopped,
}: {
  text: string;
  valores: Readonly<Record<string, Mia2Valor>> | null;
  hidden: boolean;
  note?: string | undefined;
  /** The text of an answer stopped before the check: its values carry the unchecked mark. */
  stopped: boolean;
}) => {
  const keys = Object.keys(valores ?? {}).sort((a, b) => b.length - a.length);
  // While the text is still coming, any R$ is plain (and hidden when values are).
  const money =
    keys.length > 0
      ? new RegExp(`(${keys.map(literal).join("|")})`, "g")
      : /([−-]?\s?R\$\s?[−-]?\s?[\d.,]*\d)/g;
  const pieces = (s: string, bold: boolean, key: string): ReactNode[] =>
    s.split(money).map((piece, i) => {
      const k = `${key}-${i}`;
      if (i % 2 === 0) return <Fragment key={k}>{piece}</Fragment>;
      const v = valores?.[piece] ?? (stopped ? NOT_CHECKED : undefined);
      const node = <Value key={k} texto={piece} v={v} hidden={hidden} note={note} />;
      return bold ? <strong key={k}>{node}</strong> : node;
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
}: {
  texto: string;
  valores: Readonly<Record<string, Mia2Valor>> | null;
  hidden: boolean;
  /** Her first paragraph is the answer: set like every Neko verdict. */
  lead: boolean;
  note?: string | undefined;
  stopped: boolean;
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
                  />
                </Fragment>
              ))}
            </p>
          ),
        )}
    </div>
  );
};

/** The screens an answer's checked values came from, two at most, as quiet ways out. */
const sourcesOf = (t: Turn) => {
  const seen = new Map<
    string,
    { key: string; tela: "faturas" | "mes"; mes?: string | undefined; label: string }
  >();
  for (const p of t.parts) {
    if (p.k !== "texto") continue;
    for (const v of Object.values(p.valores ?? {})) {
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

/** Her answer's pieces, each text followed by the note on its values that came from nowhere. */
const Answer = ({ t, working, hidden }: { t: Turn; working: boolean; hidden: boolean }) => {
  const first = t.parts.find((p) => p.k === "texto")?.id;
  const stoppedNote = stoppedValues(t) ? `mia-stopped-${t.n}` : undefined;
  return t.parts.map((p) => {
    if (p.k === "grafico") return <MiaChart key={p.id} grafico={p.grafico} />;
    const stopped = t.end === "parou" && p.valores === null;
    const loose = working ? [] : unchecked(p);
    const note = stopped ? stoppedNote : loose.length > 0 ? `mia-note-${t.n}-${p.id}` : undefined;
    return (
      <Fragment key={p.id}>
        <Rich
          texto={p.texto}
          valores={p.valores}
          hidden={hidden}
          lead={p.id === first}
          note={note}
          stopped={stopped}
        />
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
      </Fragment>
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
  useKeyboardResizes();
  useEffect(() => {
    if (chat.turns.length === 0) title.current?.focus({ preventScroll: true });
    return () => {
      refocusOpener();
    };
  }, []);
  // A question just sent goes to the top, under the bar; the answer then grows under it in the room
  // kept for it, never scrolled away. A starter tapped is gone: the focus waits on the page.
  useEffect(() => {
    if (!pending) return;
    last.current?.scrollIntoView({ block: "start", behavior: smooth() });
    if (document.activeElement === document.body) body.current?.focus({ preventScroll: true });
  }, [pending]);
  // A finished answer takes the focus to be read, where it is (no jump), while the owner is still
  // here. Typing the next question, or just after Parar, the field keeps it (the keyboard stays up):
  // the answer is announced instead, and a question sent while she answered goes now.
  const finished = pending === null ? turns.length : -1;
  const typedNow = useRef(typed);
  typedNow.current = typed;
  const heldNow = useRef(held);
  heldNow.current = held;
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per finished answer
  useEffect(() => {
    if (finished <= 0) return;
    const here = document.activeElement;
    const end = chat.turns.at(-1)?.end ?? null;
    if (heldNow.current) {
      setHeld(false);
      if (end === null && typedNow.current.trim()) {
        send(typedNow.current);
        return setTold("A Mia respondeu. Sua próxima pergunta foi enviada.");
      }
    }
    if (here === input.current && (typedNow.current || end === "parou")) {
      setTold(end === null ? "A Mia respondeu." : "");
      return;
    }
    if (!last.current) return;
    if (here !== document.body && here !== input.current && !body.current?.contains(here)) return;
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
    turns.length === 0 || typed.trim() || pending || resting || full ? [] : mia2Next(asked, topic);

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
        {cleared && turns.length === 0 && (
          <div className="toast inline" role="status">
            <span>Conversa apagada</span>
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
            {!resting && (
              <div className="mia-starters">
                {starters.map((q) => (
                  <button key={q} type="button" className="chip-button" onClick={() => send(q)}>
                    {q}
                  </button>
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
              const sources = newest && !working ? sourcesOf(t) : [];
              return (
                <li key={t.n} ref={newest ? last : undefined} tabIndex={newest ? -1 : undefined}>
                  <p className="mia-q">{t.pergunta}</p>
                  <Answer t={t} working={working} hidden={hidden} />
                  {working && (
                    <div className="mia-wait">
                      <span className="mia-dots" aria-hidden="true" />
                      <p className="mia-status" aria-live="polite">
                        {doing ?? (t.parts.length > 0 ? "" : miaWaiting(seconds))}
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
      </div>
      {s?.ligada && !resting && !full && (
        <div className="mia-composer">
          {held && pending && (
            <p className="mia-held" role="status">
              Sua pergunta vai quando ela terminar.
            </p>
          )}
          {next.length > 0 && (
            <div className="mia-suggest" key={turns.length}>
              {next.map((q) => (
                <button key={q} type="button" className="chip-button" onClick={() => send(q)}>
                  {q}
                </button>
              ))}
            </div>
          )}
          <form
            className="mia-form"
            onSubmit={(e) => {
              e.preventDefault();
              // While she answers, Enter keeps the next question for when she is done.
              if (!pending) send(typed);
              else if (typed.trim()) setHeld(true);
            }}
          >
            <input
              ref={input}
              aria-label="Pergunta para a Mia"
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
                // ↑ in an empty field brings back the last question, to change and send again.
                if (e.key === "ArrowUp" && !typed && !pending && turns.length > 0) {
                  e.preventDefault();
                  return setTyped(turns.at(-1)?.pergunta ?? "");
                }
                if (e.key !== "Escape") return;
                e.preventDefault();
                if (pending) halt(false);
                else if (typed) setTyped("");
                else back();
              }}
            />
            {pending ? (
              <button type="button" className="ghost mia-stop" onClick={() => halt(true)}>
                Parar
              </button>
            ) : (
              <button type="submit" disabled={!typed.trim()}>
                Enviar
              </button>
            )}
          </form>
        </div>
      )}
    </>
  );
};
