import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import { Fragment, type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ApiError, api, type MiaReply } from "./api.ts";
import { BrandMark } from "./BrandMark.tsx";
import { money, monthName, shortDate } from "./format.ts";
import { IconChevron, IconChevronLeft } from "./icons.tsx";

/** The screen Mia was opened from: her first questions are about it. */
export type MiaTopic = "hoje" | "faturas" | "mes";

/** Questions Mia answers well, one tap each (specs/004-mia), led by the screen she came from. */
const MIA_TOPICS: Record<MiaTopic, readonly string[]> = {
  hoje: ["Quanto cabe por dia?", "Como está minha reserva?"],
  faturas: ["Quanto vem nas próximas faturas?", "Qual fatura está mais alta?"],
  mes: [
    "Quanto saiu no mês passado?",
    "Este mês está melhor que o anterior?",
    "Quanto gastei com mercado este ano?",
  ],
};

/** Five questions, those about the screen Mia was opened from first. */
export const miaStarters = (topic: MiaTopic = "hoje") =>
  [...MIA_TOPICS[topic], ...Object.values(MIA_TOPICS).flat()]
    .filter((q, i, all) => all.indexOf(q) === i)
    .slice(0, 5);

/** The empty screen's title, naming the screen she was opened from. */
export const miaTitle = (topic: MiaTopic = "hoje") =>
  topic === "faturas"
    ? "Pergunte sobre as faturas"
    : topic === "mes"
      ? "Pergunte sobre o mês"
      : "Pergunte sobre a sua planilha";

/** Exchanges sent back with a question; the Worker takes no more. */
const MAX_HISTORY = 6;

const SCREEN = { hoje: "/", faturas: "/faturas", mes: "/mes" } as const;

type Value = MiaReply["valores"][string];

/**
 * A value the engine handed out. Differences and percents show their size only: the words around
 * them ("subiu", "caiu") carry the direction the engine computed.
 */
const shown = (v: Value) =>
  "pct" in v ? `${Math.abs(v.pct)}%` : money(v.tipo === "diferenca" ? Math.abs(v.cents) : v.cents);

/** Where a value leads: its screen, and on Mês the very month it came from. */
const ScreenLink = ({
  v,
  className,
  title,
  children,
}: {
  v: { readonly tela: Value["tela"]; readonly mes?: string | undefined };
  className: string;
  title?: string;
  children: ReactNode;
}) =>
  v.tela === "mes" ? (
    <Link to="/mes" search={v.mes ? { m: v.mes } : {}} className={className} title={title}>
      {children}
    </Link>
  ) : (
    <Link to={SCREEN[v.tela]} className={className} title={title}>
      {children}
    </Link>
  );

/** Mia's text with each `{{vN}}` swapped for its value, a tap away from the screen it came from. */
export const MiaText = ({ reply }: { reply: MiaReply }) => {
  const parts = reply.texto.split(/\{\{(\w+)\}\}/);
  return (
    <p className="mia-text">
      {parts.map((part, i) => {
        const key = `${i}-${part}`;
        if (i % 2 === 0) return <Fragment key={key}>{part}</Fragment>;
        const v = reply.valores[part];
        if (!v) return <Fragment key={key}>…</Fragment>;
        return (
          <ScreenLink key={key} v={v} className="mia-value" title={v.rotulo}>
            {shown(v)}
          </ScreenLink>
        );
      })}
    </p>
  );
};

/**
 * The screens an answer's numbers came from, as plain ways out: "Ver setembro", "Ver faturas".
 * Hoje is left out, the screen she is opened from. Two at most, so the answer stays the main thing.
 */
export const miaSources = (reply: MiaReply) => {
  const seen = new Map<
    string,
    { key: string; tela: Value["tela"]; mes?: string | undefined; label: string }
  >();
  const values = Object.values(reply.valores);
  // A month-less Mês value (a difference) adds nothing when the answer names its month.
  const named = values.some((v) => v.tela === "mes" && v.mes);
  for (const v of values) {
    if (v.tela === "hoje" || (v.tela === "mes" && !v.mes && named)) continue;
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
  const out = [...seen.values()].slice(0, 2);
  // Two Septembers of different years say which is which.
  return out.map((src) =>
    src.mes && out.filter((o) => o.label === src.label).length > 1
      ? { ...src, label: `${src.label} de ${src.mes.slice(0, 4)}` }
      : src,
  );
};

/** After an answer, two questions not asked yet, so the next one is a tap away. */
export const miaNext = (asked: readonly string[], topic: MiaTopic = "hoje") =>
  [...miaStarters(topic), ...Object.values(MIA_TOPICS).flat()]
    .filter((q, i, all) => all.indexOf(q) === i && !asked.includes(q))
    .slice(0, 2);

/** What the wait line says as it goes on: the answer can take a while, and silence reads as stuck. */
export const miaWaiting = (seconds: number) =>
  seconds < 6
    ? "A Mia está lendo a planilha…"
    : seconds < 20
      ? "Fazendo as contas…"
      : "Ainda calculando. Às vezes leva um minuto.";

interface Exchange {
  /** Order in the conversation, a stable key. */
  n: number;
  pergunta: string;
  reply: MiaReply;
}

/**
 * The conversation, kept outside the screen: leaving Mia to check a month and coming back finds
 * it where it was, an answer still on its way included. It ends with the page or "Nova conversa".
 */
interface Chat {
  talk: readonly Exchange[];
  /** The question waiting for its answer, and since when. */
  pending: { pergunta: string; since: number } | null;
  /** The question that just failed, waiting in "Tentar de novo". */
  failed: string | null;
  /** The month's limit was reached: she rests until the page is opened again, whatever is cleared. */
  limited: boolean;
}
let chat: Chat = { talk: [], pending: null, failed: null, limited: false };
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

const limitHit = (e: unknown) => e instanceof ApiError && e.status === 429;

const ask = async (pergunta: string, queryClient: QueryClient) => {
  if (chat.pending) return;
  const recent = chat.talk.slice(-MAX_HISTORY);
  setChat({ pending: { pergunta, since: Date.now() }, failed: null });
  try {
    const reply = await api.askMia({
      pergunta,
      historico: recent.map((x) => ({ pergunta: x.pergunta, resposta: x.reply.texto })),
      valores: Object.assign({}, ...recent.map((x) => x.reply.valores)),
    });
    setChat({ talk: [...chat.talk, { n: chat.talk.length, pergunta, reply }], pending: null });
  } catch (e) {
    // The limit was reached: the status brings the day she is back, and the screen rests.
    if (limitHit(e)) {
      setChat({ pending: null, limited: true });
      void queryClient.invalidateQueries({ queryKey: ["mia"] });
    } else setChat({ pending: null, failed: pergunta });
  }
};

/** Seconds since `since`, ticking once a second; 0 while nothing waits. */
const useSeconds = (since: number | undefined) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === undefined) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  return since === undefined ? 0 : Math.max(0, Math.floor((now - since) / 1000));
};

const useMiaStatus = () => useQuery({ queryKey: ["mia"], queryFn: api.mia, staleTime: 60_000 });

/**
 * Which way into Mia was taken, and from where: when her screen closes back onto that screen, the
 * same way in takes the focus again, so the keyboard and the screen reader carry on from there.
 */
let opener: { selector: string; path: string } | null = null;
const opened = (selector: string) => () => {
  opener = { selector, path: window.location.pathname };
};
const refocusOpener = () => {
  const o = opener;
  opener = null;
  // The screen it lives on may still be loading: a few frames, then give up quietly.
  let tries = 20;
  const look = () => {
    if (!o || window.location.pathname !== o.path) return;
    const el = document.querySelector<HTMLElement>(o.selector);
    if (el) el.focus({ preventScroll: true });
    else if (--tries > 0) requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
};

/** "Perguntar à Mia" on Hoje: hidden until the key is set, a way into her screen. */
export const Mia = () => {
  const status = useMiaStatus();
  const { talk } = useChat();
  if (!status.data?.ligada) return null;
  return (
    // A quiet row, not a third big button: Hoje already has Lançar and Simular.
    <Link to="/mia" className="alert mia-ask" onClick={opened(".mia-ask")}>
      <BrandMark width={40} className="mia-mark" />
      <span className="alert-text">
        <strong>Perguntar à Mia</strong>
        <span>
          {talk.length > 0 ? "Continuar a conversa" : "Respostas com os números da sua planilha"}
        </span>
      </span>
      <IconChevron />
    </Link>
  );
};

/**
 * Mia in the head of Hoje, Faturas and Mês, beside "ler de novo": her screen from any tab, her
 * first questions about the one it was opened from.
 */
export const MiaHead = ({ topic }: { topic: MiaTopic }) => {
  const status = useMiaStatus();
  const { talk } = useChat();
  if (!status.data?.ligada) return null;
  // With a conversation open she continues it, as the Hoje row says; otherwise she starts on this screen.
  const label =
    talk.length > 0
      ? "Continuar a conversa com a Mia"
      : `Perguntar à Mia ${miaTitle(topic).replace("Pergunte ", "")}`;
  return (
    <Link
      onClick={opened(".mia-head")}
      to="/mia"
      search={topic === "hoje" ? {} : { de: topic }}
      className="icon mia-head"
      aria-label={label}
      aria-keyshortcuts="M"
      title={`${label} (M)`}
    >
      <BrandMark width={28} className="mia-mark" />
    </Link>
  );
};

/**
 * While Mia's screen is open, a phone keyboard shrinks the page instead of covering it, so the
 * question field stays in sight above the keys (Chrome's interactive-widget; others ignore it).
 */
const useKeyboardResizes = () => {
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!meta) return;
    const before = meta.content;
    meta.content = `${before}, interactive-widget=resizes-content`;
    return () => {
      meta.content = before;
    };
  }, []);
};

/**
 * Mia's own screen: the whole page for the conversation, the question field pinned at the bottom.
 * No tabs here; the arrow (or Esc, or the phone's back) returns to where she was opened from.
 */
export const MiaScreen = ({ topic = "hoje" }: { topic?: MiaTopic | undefined }) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  const router = useRouter();
  const status = useMiaStatus();
  const { talk, pending, failed, limited } = useChat();
  const [typed, setTyped] = useState("");
  const last = useRef<HTMLLIElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const seconds = useSeconds(pending?.since);
  useKeyboardResizes();
  // Opening says where the owner landed: the title takes the focus (no keyboard pops up), or the
  // newest answer does when a conversation is waiting. Closing hands the focus back to the way in.
  useEffect(() => {
    if (chat.talk.length === 0) title.current?.focus({ preventScroll: true });
    return () => {
      refocusOpener();
    };
  }, []);
  // The newest answer is read from its top, under the bar, and takes the focus: a screen reader
  // reads it and a phone keyboard closes. Only while the owner is still here: an answer that
  // comes late never pulls them away from a field they moved on to.
  useEffect(() => {
    const here = document.activeElement;
    if (talk.length === 0 || !last.current) return;
    if (here !== document.body && here !== input.current && !body.current?.contains(here)) return;
    last.current.scrollIntoView({ block: "start" });
    last.current.focus({ preventScroll: true });
  }, [talk.length]);
  // A question just sent shows at the bottom with the wait under it.
  useEffect(() => {
    if (pending) window.scrollTo({ top: document.documentElement.scrollHeight });
  }, [pending]);
  const back = () => (canGoBack ? router.history.back() : navigate({ to: "/" }));

  const s = status.data;
  const send = (q: string) => {
    const pergunta = q.trim();
    if (!pergunta || chat.pending) return;
    setTyped("");
    void ask(pergunta, queryClient);
  };
  const resting = Boolean(s?.pausadaAte) || limited;
  // A question that just failed waits in "Tentar de novo", not again among the chips.
  const asked = [...talk.map((x) => x.pergunta), ...(failed ? [failed] : [])];
  const starters = miaStarters(topic).filter((q) => !asked.includes(q));
  const next = talk.length === 0 || typed.trim() || pending || resting ? [] : miaNext(asked, topic);

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
        {talk.length > 0 && (
          // Stays put while an answer is on its way, so the bar does not jump; usable again after.
          <button
            type="button"
            className="text-link mia-restart"
            disabled={Boolean(pending)}
            onClick={() => {
              setChat({ talk: [], failed: null });
              // The button goes away with the conversation; the focus lands where the next one starts.
              (input.current ?? body.current)?.focus();
            }}
          >
            Nova conversa
          </button>
        )}
      </header>
      <div className="mia-body" ref={body} tabIndex={-1}>
        {s && !s.ligada ? (
          <p className="muted mia-lead">A Mia não está ligada neste Neko.</p>
        ) : (
          <>
            {/* Paused on opening: said first. Reached while asking: said where the wait was, aloud. */}
            {s?.pausadaAte && !limited && (
              <p className="muted mia-lead">
                A Mia descansa até {shortDate(s.pausadaAte)}. Os números seguem nas telas.
              </p>
            )}
            {talk.length === 0 && !pending && (
              <div className="mia-empty">
                <h2>{miaTitle(topic)}</h2>
                <p className="muted">
                  A Mia responde com os números das telas do Neko, e cada um leva à tela de onde
                  veio.
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
            {(talk.length > 0 || pending) && (
              <ol className="mia-talk" aria-label="Conversa com a Mia">
                {talk.map((x, i) => {
                  const newest = i === talk.length - 1 && !pending;
                  // Only the newest answer offers its screens, so older ones stay plain text.
                  const sources = newest ? miaSources(x.reply) : [];
                  return (
                    <li
                      key={x.n}
                      ref={i === talk.length - 1 ? last : undefined}
                      tabIndex={i === talk.length - 1 ? -1 : undefined}
                    >
                      <p className="mia-q">{x.pergunta}</p>
                      <MiaText reply={x.reply} />
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
                {pending && (
                  <li>
                    <p className="mia-q">{pending.pergunta}</p>
                  </li>
                )}
              </ol>
            )}
            <div className="mia-wait">
              {pending && <span className="mia-dots" aria-hidden="true" />}
              <p className="mia-status" aria-live="polite">
                {pending
                  ? miaWaiting(seconds)
                  : limited
                    ? "A Mia descansa até o mês que vem. Os números seguem nas telas."
                    : failed
                      ? "Não consegui falar com a Mia agora."
                      : ""}
              </p>
              {failed && !pending && !limited && (
                <button type="button" className="text-link mia-retry" onClick={() => send(failed)}>
                  Tentar de novo
                </button>
              )}
            </div>
          </>
        )}
      </div>
      {s?.ligada && !resting && (
        <div className="mia-composer">
          {next.length > 0 && (
            // A new row starts at its first question, not where the last one was slid to.
            <div className="mia-suggest" key={talk.length}>
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
              send(typed);
            }}
          >
            <input
              ref={input}
              aria-label="Pergunta para a Mia"
              placeholder={talk.length > 0 ? "Outra pergunta?" : "Pergunte algo"}
              maxLength={500}
              autoComplete="off"
              enterKeyHint="send"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              // Esc clears what was typed, and on an empty field goes back, as the arrow says.
              onKeyDown={(e) => {
                if (e.key !== "Escape") return;
                e.preventDefault();
                if (typed) setTyped("");
                else back();
              }}
            />
            <button type="submit" disabled={!typed.trim() || Boolean(pending)}>
              Enviar
            </button>
          </form>
        </div>
      )}
    </>
  );
};
