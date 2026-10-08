import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api, type UserSettings } from "../api.ts";
import { Banks } from "../Banks.tsx";
import { Devices } from "../Devices.tsx";
import { toCents } from "../format.ts";
import { resetHints } from "../Hint.tsx";
import { IconChevron } from "../icons.tsx";
import { IDEAS, LEARN_INTRO } from "../learn.ts";
import { Reminders } from "../Reminders.tsx";
import { ErrorBlock, Skeleton, useProjection } from "../useProjection.tsx";

const fromCents = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2).replace(".", ","));

interface Card {
  name: string;
  dueDay: number;
  closingDay: number;
}

interface Values {
  daily: string;
  budget: string;
  usualCard: string;
  closing: Record<string, string>;
  others: readonly string[];
}

/** How long typing must pause before a typed field saves on its own. */
const TYPING_PAUSE = 1200;

const badMoney = (s: string) => s.trim() !== "" && toCents(s) === null;
const badDay = (s: string | undefined) =>
  s !== undefined &&
  s.trim() !== "" &&
  !(Number(s) >= 1 && Number(s) <= 31 && Number.isInteger(Number(s)));

const payload = (
  v: Values,
  cards: readonly Card[],
  reviewed: readonly string[],
): Omit<UserSettings, "bankCards"> => ({
  dailyForecast: toCents(v.daily),
  cycleBudget: toCents(v.budget),
  usualCard: v.usualCard || null,
  othersCards: [...v.others],
  cards: cards.flatMap((c) => {
    const day = v.closing[c.name]?.trim();
    return day ? [{ name: c.name, dueDay: c.dueDay, closingDay: Number(day) }] : [];
  }),
  // Checked Conferência points are set from Hoje; saving here keeps them.
  reviewed: [...reviewed],
});

/**
 * Settings as a grouped list that saves itself: a switch or a picker saves on change, a typed
 * field when it loses focus or a moment after typing stops (closing the app mid-edit keeps it).
 * Invalid fields say so in place and are not sent.
 */
const Form = ({ initial, cards }: { initial: UserSettings; cards: readonly Card[] }) => {
  const queryClient = useQueryClient();
  const projection = useProjection();
  const [v, setV] = useState<Values>({
    daily: fromCents(initial.dailyForecast),
    budget: fromCents(initial.cycleBudget),
    usualCard: initial.usualCard ?? "",
    closing: Object.fromEntries(initial.cards.map((c) => [c.name, String(c.closingDay)])),
    others: initial.othersCards,
  });
  const [left, setLeft] = useState<ReadonlySet<string>>(new Set());
  const saved = useRef(JSON.stringify(payload(v, cards, initial.reviewed)));
  const save = useMutation({
    mutationFn: api.saveSettings,
    onSuccess: () => queryClient.invalidateQueries(),
  });

  const invalid = (x: Values) =>
    badMoney(x.daily) || badMoney(x.budget) || cards.some((c) => badDay(x.closing[c.name]));
  const commit = (next: Values) => {
    if (invalid(next)) return;
    // Points hidden on Hoje since this form opened stay hidden: the latest list wins.
    const reviewed =
      queryClient.getQueryData<UserSettings>(["settings"])?.reviewed ?? initial.reviewed;
    const body = payload(next, cards, reviewed);
    const json = JSON.stringify(body);
    if (json === saved.current) return;
    saved.current = json;
    save.mutate(body);
  };
  const typing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(typing.current), []);
  const change = (patch: Partial<Values>, now = false) => {
    const next = { ...v, ...patch };
    setV(next);
    clearTimeout(typing.current);
    if (now) commit(next);
    else typing.current = setTimeout(() => commit(next), TYPING_PAUSE);
  };
  const blur = (field: string) => {
    clearTimeout(typing.current);
    setLeft(new Set(left).add(field));
    commit(v);
  };
  const shows = (field: string, bad: boolean) => left.has(field) && bad;
  const auto = projection.data ? fromCents(projection.data.projection.dailyForecast) : "";

  return (
    <form
      className="form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        commit(v);
      }}
    >
      {/* The screen's name is in the masthead; saving shows beside the first group's title. */}
      <span
        role="status"
        className={`chip save-status ${save.isError ? "bad" : save.isPending ? "" : "ok"}`}
      >
        {save.isIdle ? "" : save.isError ? "Não salvou" : save.isPending ? "Salvando…" : "Salvo"}
      </span>

      <section className="group" aria-labelledby="g-forecast">
        <h2 id="g-forecast">Ritmo</h2>
        <div className="panel list">
          <label className="setting">
            <span className="label">
              Diário
              <span className={shows("daily", badMoney(v.daily)) ? "sub error" : "sub"}>
                {shows("daily", badMoney(v.daily))
                  ? "Use um valor como 177,00"
                  : "Em branco, vem da planilha"}
              </span>
            </span>
            <span className="affix">
              <span aria-hidden="true">R$</span>
              <input
                inputMode="decimal"
                placeholder={auto}
                value={v.daily}
                aria-invalid={shows("daily", badMoney(v.daily))}
                onChange={(e) => change({ daily: e.target.value })}
                onBlur={() => blur("daily")}
              />
            </span>
          </label>
          <label className="setting">
            <span className="label">
              Cartão principal
              <span className="sub">O que aparece em Hoje</span>
            </span>
            <select
              value={v.usualCard}
              onChange={(e) => change({ usualCard: e.target.value }, true)}
            >
              <option value="">Automático</option>
              {cards.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="setting">
            <span className="label">
              Plano por ciclo
              <span className={shows("budget", badMoney(v.budget)) ? "sub error" : "sub"}>
                {shows("budget", badMoney(v.budget))
                  ? "Use um valor como 5.000,00"
                  : "Em branco, diário × dias do ciclo"}
              </span>
            </span>
            <span className="affix">
              <span aria-hidden="true">R$</span>
              <input
                inputMode="decimal"
                placeholder="Automático"
                value={v.budget}
                aria-invalid={shows("budget", badMoney(v.budget))}
                onChange={(e) => change({ budget: e.target.value })}
                onBlur={() => blur("budget")}
              />
            </span>
          </label>
        </div>
      </section>

      <section className="group" aria-labelledby="g-cards">
        <h2 id="g-cards">Cartões</h2>
        <div className="panel">
          <div className="card-head" aria-hidden="true">
            <span>Cartão</span>
            <span>Outra pessoa</span>
            <span>Fecha dia</span>
          </div>
          <ul className="card-settings">
            {cards.map((c) => {
              const bad = shows(`closing-${c.name}`, badDay(v.closing[c.name]));
              const other = v.others.includes(c.name);
              return (
                <li key={c.name}>
                  <span className="who">
                    <span className="name">{c.name}</span>
                    <span className={bad ? "hint error" : "hint"}>
                      {bad ? "Dia de 1 a 31" : `Vence dia ${c.dueDay}`}
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    className="switch"
                    aria-label={`${c.name} é de outra pessoa`}
                    aria-checked={other}
                    checked={other}
                    onChange={(e) =>
                      change(
                        {
                          others: e.target.checked
                            ? [...v.others, c.name]
                            : v.others.filter((n) => n !== c.name),
                        },
                        true,
                      )
                    }
                  />
                  <input
                    className="closing"
                    type="text"
                    inputMode="numeric"
                    aria-label={`Dia de fechamento do ${c.name}`}
                    placeholder={`≈ ${c.closingDay}`}
                    value={v.closing[c.name] ?? ""}
                    aria-invalid={bad}
                    onChange={(e) =>
                      change({ closing: { ...v.closing, [c.name]: e.target.value } })
                    }
                    onBlur={() => blur(`closing-${c.name}`)}
                  />
                </li>
              );
            })}
          </ul>
        </div>
        <p className="footnote">
          Cartões de outra pessoa ficam fora do seu ritmo. Dias com ≈ são estimados: confira na
          fatura.
        </p>
      </section>
    </form>
  );
};

export const Ajustes = () => {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const projection = useProjection();

  if (settings.isError || projection.isError)
    return (
      <ErrorBlock
        title="Não consegui abrir os ajustes"
        text="Pode ser a conexão. Nada foi alterado."
        retry={() => {
          settings.refetch();
          projection.refetch();
        }}
      />
    );
  if (!settings.data || !projection.data) return <Skeleton />;

  return (
    <>
      <Form initial={settings.data} cards={projection.data.cardsKnown} />
      <Banks sheetCards={projection.data.cardsKnown.map((c) => c.name)} />
      <section className="group" aria-labelledby="g-device">
        <h2 id="g-device">Neste aparelho</h2>
        <div className="panel list">
          <Reminders />
        </div>
      </section>
      <Devices />
      <HowItWorks reviewed={settings.data} />
      <section className="group" aria-label="Sessão">
        <div className="panel list">
          <a className="setting link" href="/privacidade" target="_blank" rel="noreferrer">
            Política de privacidade
            <IconChevron />
          </a>
          <button
            type="button"
            className="setting danger"
            onClick={() =>
              api.logout().then(() => queryClient.invalidateQueries({ queryKey: ["me"] }))
            }
          >
            Sair deste aparelho
          </button>
        </div>
      </section>
    </>
  );
};

/** Every idea the tips teach, one tap each, for whoever skipped a tip or wants it again. */
const HowItWorks = ({ reviewed: s }: { reviewed: UserSettings }) => {
  const [reset, setReset] = useState(false);
  const [restored, setRestored] = useState(false);
  const queryClient = useQueryClient();
  // Conferência points set aside on Hoje come back here, all at once, whenever wanted.
  const restore = useMutation({
    mutationFn: api.saveSettings,
    onSuccess: (saved) => {
      queryClient.setQueryData(["settings"], saved);
      setRestored(true);
    },
  });
  return (
    <section className="group" aria-labelledby="g-learn">
      <h2 id="g-learn">Como funciona</h2>
      <div className="panel list learn">
        <p className="learn-text">{LEARN_INTRO}</p>
        {IDEAS.map((idea) => (
          <details key={idea.title} className="formula">
            <summary>
              <IconChevron />
              {idea.title}
            </summary>
            <p>{idea.body}</p>
          </details>
        ))}
        {/* Only where there is a keyboard to press them. */}
        <p className="learn-text keys">
          Atalhos: <kbd>1</kbd> a <kbd>4</kbd> trocam de tela, <kbd>R</kbd> lê a planilha,{" "}
          <kbd>L</kbd> abre o lançamento, <kbd>←</kbd> <kbd>→</kbd> trocam o mês.
        </p>
        <button
          type="button"
          className="setting quiet"
          disabled={reset}
          onClick={() => {
            resetHints();
            setReset(true);
          }}
        >
          {reset ? "As dicas voltam, uma por visita" : "Rever dicas"}
        </button>
        {(s.reviewed.length > 0 || restored) && (
          <button
            type="button"
            className="setting quiet"
            disabled={restore.isPending || restored}
            onClick={() => restore.mutate({ ...s, reviewed: [] })}
          >
            {restored
              ? "Os pontos voltam em Hoje"
              : restore.isPending
                ? "Trazendo de volta…"
                : "Mostrar de novo os pontos conferidos"}
          </button>
        )}
        {restore.isError && (
          <p className="setting-error" role="status">
            Não salvou. Tente de novo.
          </p>
        )}
      </div>
    </section>
  );
};
