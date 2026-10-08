import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Fragment, useId, useState } from "react";
import { ApiError, api, type MiaReply } from "./api.ts";
import { money, shortDate } from "./format.ts";
import { Mascot } from "./Mascot.tsx";

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
          <Link key={key} className="mia-value" to={SCREEN[v.tela]} title={v.rotulo}>
            {shown(v)}
          </Link>
        );
      })}
    </p>
  );
};

interface Exchange {
  /** Order in the conversation, a stable key. */
  n: number;
  pergunta: string;
  reply: MiaReply;
}

const failure = (e: unknown) => {
  if (e instanceof ApiError && e.status === 429) return "A Mia usou o limite do mês e volta logo.";
  return "Não consegui falar com a Mia agora. Os números seguem nas telas.";
};

/** "Perguntar à Mia" on Hoje: hidden until the key is set, a conversation once opened. */
export const Mia = () => {
  const id = useId();
  const status = useQuery({ queryKey: ["mia"], queryFn: api.mia, staleTime: 60_000 });
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [talk, setTalk] = useState<readonly Exchange[]>([]);
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
  const s = status.data;
  if (!s?.ligada) return null;
  const send = (q: string) => {
    const pergunta = q.trim();
    if (pergunta && !ask.isPending) ask.mutate(pergunta);
  };

  return (
    <>
      <button
        type="button"
        className="ghost mia-ask"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => setOpen(!open)}
      >
        Perguntar à Mia
      </button>
      {open && (
        <section id={`${id}-panel`} className="panel mia" aria-label="Conversa com a Mia">
          <div className="mia-head">
            <Mascot pose="miaTeaching" height={56} />
            <p className="muted mia-lead">
              {s.pausadaAte
                ? `A Mia descansa até ${shortDate(s.pausadaAte)}.`
                : "Pergunte sobre a sua planilha. Os valores vêm do Neko."}
            </p>
          </div>
          {talk.length > 0 && (
            <ol className="mia-talk">
              {talk.map((x) => (
                <li key={x.n}>
                  <p className="mia-q">{x.pergunta}</p>
                  <MiaText reply={x.reply} />
                </li>
              ))}
            </ol>
          )}
          <p className="mia-status" aria-live="polite">
            {ask.isPending ? "A Mia está lendo a planilha…" : ask.isError ? failure(ask.error) : ""}
          </p>
          {talk.length === 0 && !s.pausadaAte && (
            <div className="mia-suggest">
              {MIA_SUGGESTIONS.map((q) => (
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
                placeholder="Pergunte algo"
                maxLength={500}
                autoComplete="off"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
              />
              <button type="submit" disabled={!typed.trim() || ask.isPending}>
                Enviar
              </button>
            </form>
          )}
        </section>
      )}
    </>
  );
};
