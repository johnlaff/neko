import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Fragment, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { ApiError, api, type MiaReply } from "./api.ts";
import { BrandMark } from "./BrandMark.tsx";
import { money, monthName, shortDate } from "./format.ts";
import { IconChevron } from "./icons.tsx";

/** Questions Mia answers well, one tap each (specs/004-mia). */
export const MIA_SUGGESTIONS = [
  "Quanto cabe por dia?",
  "Quanto saiu no mês passado?",
  "Este mês está melhor que o anterior?",
  "Quanto gastei com mercado este ano?",
  "Como está minha reserva?",
] as const;

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
 * Hoje is left out, since Mia lives there. Two at most, so the answer stays the main thing.
 */
export const miaSources = (reply: MiaReply) => {
  const seen = new Map<string, { tela: Value["tela"]; mes?: string | undefined; label: string }>();
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
    seen.set(key, { tela: v.tela, mes: v.mes, label });
  }
  return [...seen.values()].slice(0, 2);
};

/** After an answer, two questions not asked yet, so the next one is a tap away. */
export const miaNext = (asked: readonly string[]) =>
  MIA_SUGGESTIONS.filter((q) => !asked.includes(q)).slice(0, 2);

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

const failure = (e: unknown) => {
  if (e instanceof ApiError && e.status === 429) return "A Mia descansa até o mês que vem.";
  return "Não consegui falar com a Mia agora.";
};

/** Seconds since `on` turned true, ticking once a second; 0 while off. */
const useSeconds = (on: boolean) => {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    setSeconds(0);
    if (!on) return;
    const started = Date.now();
    const t = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [on]);
  return seconds;
};

/** "Perguntar à Mia" on Hoje: hidden until the key is set, a conversation once opened. */
export const Mia = () => {
  const id = useId();
  const status = useQuery({ queryKey: ["mia"], queryFn: api.mia, staleTime: 60_000 });
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [talk, setTalk] = useState<readonly Exchange[]>([]);
  const last = useRef<HTMLLIElement>(null);
  const ask = useMutation({
    mutationFn: (pergunta: string) => {
      const recent = talk.slice(-MAX_HISTORY);
      return api.askMia({
        pergunta,
        historico: recent.map((x) => ({ pergunta: x.pergunta, resposta: x.reply.texto })),
        valores: Object.assign({}, ...recent.map((x) => x.reply.valores)),
      });
    },
    onSuccess: (reply, pergunta) => {
      setTalk([...talk, { n: talk.length, pergunta, reply }]);
      setTyped("");
    },
  });
  const seconds = useSeconds(ask.isPending);
  // The new answer takes the focus: a screen reader reads it, and a phone keyboard closes over it.
  useEffect(() => {
    if (talk.length > 0) last.current?.focus();
  }, [talk.length]);
  const s = status.data;
  if (!s?.ligada) return null;
  const send = (q: string) => {
    const pergunta = q.trim();
    if (pergunta && !ask.isPending) ask.mutate(pergunta);
  };
  const next = typed.trim() || ask.isPending ? [] : miaNext(talk.map((x) => x.pergunta));
  const chips = talk.length === 0 ? MIA_SUGGESTIONS : next;

  return (
    <>
      {/* A quiet row, not a third big button: Hoje already has Lançar and Simular. */}
      <button
        type="button"
        className="alert mia-ask"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => setOpen(!open)}
      >
        <BrandMark width={40} className="mia-mark" />
        <span className="alert-text">
          <strong>Perguntar à Mia</strong>
          <span>Respostas com os números da sua planilha</span>
        </span>
        <IconChevron />
      </button>
      {open && (
        <section id={`${id}-panel`} className="panel mia" aria-label="Conversa com a Mia">
          {s.pausadaAte && (
            <p className="muted mia-lead">
              A Mia descansa até {shortDate(s.pausadaAte)}. Os números seguem nas telas.
            </p>
          )}
          {talk.length > 0 && (
            <ol className="mia-talk">
              {talk.map((x, i) => (
                <li key={x.n} ref={i === talk.length - 1 ? last : undefined} tabIndex={-1}>
                  <p className="mia-q">{x.pergunta}</p>
                  <MiaText reply={x.reply} />
                  {miaSources(x.reply).length > 0 && (
                    <p className="mia-sources">
                      {miaSources(x.reply).map((src) => (
                        <ScreenLink key={src.label} v={src} className="mia-source">
                          {src.label}
                          <IconChevron />
                        </ScreenLink>
                      ))}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
          <div className="mia-wait">
            {ask.isPending && <span className="mia-dots" aria-hidden="true" />}
            <p className="mia-status" aria-live="polite">
              {ask.isPending ? miaWaiting(seconds) : ask.isError ? failure(ask.error) : ""}
            </p>
            {ask.isError && !(ask.error instanceof ApiError && ask.error.status === 429) && (
              <button
                type="button"
                className="ghost small"
                onClick={() => ask.variables && send(ask.variables)}
              >
                Tentar de novo
              </button>
            )}
          </div>
          {chips.length > 0 && !s.pausadaAte && (
            // A new row starts at its first question, not where the last one was slid to.
            <div className="mia-suggest" key={talk.length}>
              {chips.map((q) => (
                <button
                  key={q}
                  type="button"
                  className="chip-button"
                  disabled={ask.isPending}
                  onClick={() => send(q)}
                >
                  {q}
                </button>
              ))}
            </div>
          )}
          {!s.pausadaAte && (
            <form
              className="mia-form"
              onSubmit={(e) => {
                e.preventDefault();
                send(typed);
              }}
            >
              <input
                aria-label="Pergunta para a Mia"
                placeholder={talk.length > 0 ? "Pergunte mais" : "Pergunte algo"}
                maxLength={500}
                autoComplete="off"
                enterKeyHint="send"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
              />
              <button type="submit" disabled={!typed.trim() || ask.isPending}>
                Enviar
              </button>
            </form>
          )}
          {talk.length > 0 && !ask.isPending && (
            <button
              type="button"
              className="text-link mia-restart"
              onClick={() => {
                setTalk([]);
                ask.reset();
              }}
            >
              Nova conversa
            </button>
          )}
        </section>
      )}
    </>
  );
};
