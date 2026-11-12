import {
  type Cents,
  type Change,
  type ChangeEffect,
  type Effect,
  type LocalDate,
  MAX_CHANGES,
  type Pace,
} from "@neko/engine";
import { useQuery } from "@tanstack/react-query";
import { Link, useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type ScenarioView, scenarioView } from "../../shared/screens.ts";
import { api, type ProjectionResponse } from "../api.ts";
import { capitalize, dayLabel, monthName, readAtLabel, roundMoney, toCents } from "../format.ts";
import { IconChevron, IconChevronLeft, IconClose, IconPlus } from "../icons.tsx";
import { simFigure } from "../Pace.tsx";
import { SimChart } from "../SimChart.tsx";
import { WithProjection } from "../useProjection.tsx";

/** How Brazilian stores usually split a card purchase. */
const PARCELS = [1, 2, 3, 6, 10, 12] as const;
/** Money in or out once, or on the same day for months (a freela, a loan's parcels). */
const REPEATS = [1, 3, 12, 24] as const;
/** Past this a typo, not a plan: R$ 10 milhões. */
const MAX_AMOUNT = 1_000_000_000;
/**
 * An amount as the owner writes it, also half typed: `250`, `1.500,50`, `1.500,`. A dot after the
 * comma (`1,500.50`), a sign or a letter is a typo, and it says so at once, while typing, so no
 * message ever appears under a finger on its way to another button.
 */
const PT_MONEY = /^\d[\d.]*(,\d{0,2})?$/;

type Kind = Change["kind"];
interface Row {
  readonly key: number;
  readonly kind: Kind;
  readonly typed: string;
  /** Parcels of a purchase, or months of money in or out. */
  readonly count: number;
  readonly date: string;
}

const PACE_LABEL: Record<Pace, string> = {
  planilha: "Só a planilha",
  teto: "Teto",
  media: "Média",
};
/** How each answer starts, so the premise is never in another place than the number. */
const PACE_LEAD: Record<Pace, string> = {
  planilha: "Só com a planilha",
  teto: "Gastando o teto",
  media: "Gastando a média",
};
/** Where a purchase's parcels go when the pace already fills the month. */
const PACE_INSIDE: Record<Pace, string> = {
  planilha: "",
  teto: "dentro do teto",
  media: "dentro da média",
};
const KIND_LABEL: Record<Kind, string> = { compra: "Compra", entrada: "Entrada", saida: "Saída" };
/** One change on its own is the subject of the answer's sentence. */
const KIND_NOUN: Record<Kind, string> = {
  compra: "A compra",
  entrada: "A entrada",
  saida: "A saída",
};

/** "dez", or "dez 2027" when it is not this year: the same month in every place on the screen. */
const monthLabel = (year: number, month: number, today: string) =>
  `${monthName(month).slice(0, 3)}${String(year) === today.slice(0, 4) ? "" : ` ${year}`}`;
const monthOf = (yyyyMm: string, today: string) =>
  monthLabel(Number(yyyyMm.slice(0, 4)), Number(yyyyMm.slice(5, 7)), today);

/** The typed amount in cents, or null while it is empty, malformed or past any plan. */
const amountOf = (typed: string): number | null => {
  const t = typed.trim();
  if (!PT_MONEY.test(t)) return null;
  const c = toCents(t);
  return c && c <= MAX_AMOUNT ? c : null;
};

interface Asked {
  readonly key: number;
  readonly kind: Kind;
  readonly change: Change;
}

/** The rows that say enough to simulate: an amount, and a day from today on. */
const changesOf = (rows: readonly Row[], today: string, card: boolean): Asked[] =>
  rows.flatMap((r): Asked[] => {
    const amount = amountOf(r.typed);
    if (!amount) return [];
    if (r.kind === "compra")
      return card
        ? [
            {
              key: r.key,
              kind: r.kind,
              change: { kind: "compra", amount: amount as Cents, count: r.count },
            },
          ]
        : [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date) || r.date < today) return [];
    return [
      {
        key: r.key,
        kind: r.kind,
        change: {
          kind: r.kind,
          amount: amount as Cents,
          date: r.date as LocalDate,
          months: r.count,
        },
      },
    ];
  });

/** Under a real, the amount reads R$ 0: say it does not move it, never "tira R$ 0". */
const none = (d: number) => Math.round(d / 100) === 0;

/**
 * "As mudanças tiram R$ 300 do menor saldo e R$ 1.800 do fim de dez 2027." With one change it is
 * that change, in the singular: "A compra tira…", and "Sozinha, tira…" in its own row.
 */
const deltaSentence = (e: Effect, endLabel: string, who: string, plural: boolean) => {
  const verb = (pl: string, sg: string) => (plural ? pl : sg);
  const part = (d: number, what: string, withVerb: boolean) =>
    none(d)
      ? `${verb("não mexem", "não mexe")} no ${what}`
      : d < 0
        ? `${withVerb ? `${verb("tiram", "tira")} ` : ""}${roundMoney(-d)} do ${what}`
        : `${withVerb ? `${verb("somam", "soma")} ` : ""}${roundMoney(d)} ao ${what}`;
  const sameWay = Math.sign(e.lowest) === Math.sign(e.end) && !none(e.lowest) && !none(e.end);
  return `${who} ${part(e.lowest, "menor saldo", true)} e ${part(e.end, `fim de ${endLabel}`, !sameWay)}.`;
};

/** What the pace holds of the purchases: it moves no balance and leaves less of each month. */
const inPaceSentence = (effects: readonly ChangeEffect[], pace: Pace) => {
  const held = effects.flatMap((e) => (e.inPace ? [e.inPace] : []));
  if (held.length === 0) return "";
  const total = held.reduce((t, h) => t + h.amount, 0);
  const parcels = held.reduce((t, h) => t + h.count, 0);
  return parcels > 1
    ? `${roundMoney(total)} em parcelas ficam ${PACE_INSIDE[pace]}: não mexem no saldo, mas deixam menos para o resto de cada mês.`
    : `${roundMoney(total)} da compra fica ${PACE_INSIDE[pace]}: não mexe no saldo, mas deixa menos para o resto do mês.`;
};

/** A live text that waits for the typing to settle, so a screen reader reads the answer once. */
const useSettled = (text: string, ms = 700) => {
  const [settled, setSettled] = useState(text);
  useEffect(() => {
    const t = setTimeout(() => setSettled(text), ms);
    return () => clearTimeout(t);
  }, [text, ms]);
  return settled;
};

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Back where Simular was opened from: its button on Hoje takes the focus again. */
const refocusOpener = () => {
  let tries = 20;
  const look = () => {
    const el = document.querySelector<HTMLElement>('a[href="/simular"]');
    if (el) el.focus({ preventScroll: true });
    else if (--tries > 0) requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
};

/** Whether the bar's title holds the focus: the one place where Esc leaves the screen. */
const useTitleFocused = () => {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const read = () => setOn(document.activeElement?.matches(".sim-bar > h1") ?? false);
    const later = () => setTimeout(read, 0);
    document.addEventListener("focusin", read);
    document.addEventListener("focusout", later);
    return () => {
      document.removeEventListener("focusin", read);
      document.removeEventListener("focusout", later);
    };
  }, []);
  return on;
};

/**
 * Simular: how the months ahead would look from today, on demand. The sheet keeps only what is
 * certain; here the spending of the day to day (at the ceiling, or as in the last months) and a
 * few what-ifs shift copies of its balances, as the method's own Ctrl+Z. Nothing is saved, and
 * leaving the screen forgets it all.
 */
export const Simular = () => {
  const navigate = useNavigate();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const title = useRef<HTMLHeadingElement>(null);
  // The bar holds a one-line answer while the real one is scrolled away.
  const [peek, setPeek] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    title.current?.focus({ preventScroll: true });
    return refocusOpener;
  }, []);
  const back = () => (canGoBack ? router.history.back() : navigate({ to: "/" }));
  return (
    <>
      <header className="sim-bar">
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
          Simular
        </h1>
        <div ref={setPeek} className="sim-peek-slot" />
      </header>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Esc inside the sandbox steps out to the title before it leaves, so one stray key never wipes the what-ifs */}
      <div
        className="sim-body"
        onKeyDown={(e) => {
          if (e.key !== "Escape" || e.defaultPrevented) return;
          e.preventDefault();
          title.current?.focus();
        }}
      >
        <WithProjection loading={<SimSkeleton />}>
          {(data) => <Settled data={data} peek={peek} />}
        </WithProjection>
      </div>
    </>
  );
};

/** The screen's own shape while it loads: the answer with its chart, then the what-ifs. */
const SimSkeleton = () => (
  <div className="skeleton sim-skeleton" aria-busy="true">
    <span className="sr-only">Carregando</span>
    <i className="line short" />
    <div className="panel">
      <i className="line" />
      <i className="line short" />
      <div className="sk-row">
        <i className="pill" />
        <i className="pill" />
        <i className="pill" />
      </div>
      <i className="block" />
    </div>
    <div className="panel">
      <i className="line short" />
      <div className="sk-row">
        <i className="pill" />
        <i className="pill" />
        <i className="pill" />
      </div>
    </div>
  </div>
);

/** Ajustes comes first: the ceiling decides where the answer starts, so it never flips. */
const Settled = ({ data, peek }: { data: ProjectionResponse; peek: HTMLElement | null }) => {
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  if (settings.isPending) return <SimSkeleton />;
  return (
    <Sandbox
      data={data}
      ceiling={(settings.data?.cycleBudget ?? null) as Cents | null}
      noSettings={settings.isError}
      peek={peek}
    />
  );
};

const Sandbox = ({
  data,
  ceiling,
  noSettings,
  peek,
}: {
  data: ProjectionResponse;
  ceiling: Cents | null;
  /** Ajustes could not be read: no ceiling to offer, and the screen says why. */
  noSettings: boolean;
  peek: HTMLElement | null;
}) => {
  const p = data.projection;
  const [chosen, setChosen] = useState<Pace | null>(null);
  const [rows, setRows] = useState<readonly Row[]>([]);
  const next = useRef(0);
  const focusKey = useRef<number | null>(null);
  const changesTitle = useRef<HTMLHeadingElement>(null);
  const [verdictEl, setVerdictEl] = useState<HTMLElement | null>(null);
  const [verdictSeen, setVerdictSeen] = useState(true);
  const titleFocused = useTitleFocused();
  useEffect(() => {
    if (!verdictEl || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setVerdictSeen(e?.isIntersecting ?? true), {
      rootMargin: "-72px 0px 0px 0px",
    });
    io.observe(verdictEl);
    return () => io.disconnect();
  }, [verdictEl]);

  const asked = changesOf(
    rows,
    p.today,
    p.cards.some((c) => c.usual),
  );
  // The view leaves out what the engine refuses and says which; only a sheet with no months
  // ahead leaves nothing to answer.
  let r: ScenarioView | null = null;
  try {
    r = scenarioView(data, ceiling, {
      pace: chosen ?? undefined,
      changes: asked.map((a) => a.change),
    });
  } catch {
    r = null;
  }
  const refused = asked.filter((_, i) => r?.refused.includes(i));
  const used = asked.filter((_, i) => !r?.refused.includes(i));
  const effectOf = (key: number) => {
    const i = used.findIndex((a) => a.key === key);
    return i < 0 ? null : (r?.effects[i] ?? null);
  };

  const lead = r ? PACE_LEAD[r.pace] : "";
  const red = r?.firstNegative ?? null;
  const lowest = r?.lowest ?? null;
  const endMonth = r?.months.at(-1);
  const endLabel = r && endMonth ? monthLabel(endMonth.year, endMonth.month, p.today) : "";
  // A lowest day in the sheet's last month may not be the bottom: past it nothing is known.
  const atEdge = !!(r && lowest && lowest.date.slice(0, 7) === r.end.slice(0, 7));
  const verdict = !r
    ? ""
    : red
      ? `${lead}, fica negativo em ${dayLabel(red.date, p.today)}.`
      : lowest
        ? `${lead}, o menor saldo é ${roundMoney(lowest.balance)}, em ${dayLabel(lowest.date, p.today)}${atEdge ? ", no último mês da planilha" : ""}.`
        : "";
  const single = used.length === 1 ? used[0] : undefined;
  const deltaText =
    r?.effect && endMonth
      ? deltaSentence(r.effect, endLabel, single ? KIND_NOUN[single.kind] : "As mudanças", !single)
      : "";
  const heldText = r ? inPaceSentence(r.effects, r.pace) : "";
  const wayOut =
    red && lowest
      ? `Para não ficar negativo, faltam ${roundMoney(-lowest.balance)} no pior dia, ${dayLabel(lowest.date, p.today)}.`
      : "";
  const status = useSettled([verdict, deltaText, heldText].filter(Boolean).join(" "));

  const add = (kind: Kind) => {
    const key = next.current++;
    focusKey.current = key;
    setRows((rs) => [...rs, { key, kind, typed: "", count: 1, date: p.today }]);
  };
  const edit = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const remove = (key: number) => {
    const i = rows.findIndex((x) => x.key === key);
    // The focus goes to the row next to it, or to the panel's title when it was the last one.
    const near = rows[i - 1] ?? rows[i + 1];
    focusKey.current = near?.key ?? null;
    if (!near) requestAnimationFrame(() => changesTitle.current?.focus());
    setRows((rs) => rs.filter((x) => x.key !== key));
  };

  if (!r || r.days.length < 2)
    return (
      <p className="muted">
        A planilha termina hoje: não há meses à frente para simular. Abra a aba do próximo ano na
        planilha e volte aqui.
      </p>
    );
  const same = r.days.every((d) => d.sim === d.sheet);
  const saving = r.saving;
  const scrollToAnswer = () =>
    document
      .getElementById("sim-answer")
      ?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  const effect = r.effect;

  return (
    <>
      <p className="sim-lead">
        Planilha lida {readAtLabel(data.sheet.readAt)}. Nada aqui muda a planilha; quando você sai,
        tudo some.
      </p>
      <p className="sr-only" role="status">
        {status}
      </p>
      {peek &&
        rows.length > 0 &&
        (titleFocused
          ? createPortal(
              <p className="sim-peek-hint">Esc de novo sai e apaga as mudanças.</p>,
              peek,
            )
          : !verdictSeen &&
            createPortal(
              <button type="button" className="sim-peek" onClick={scrollToAnswer}>
                <span className={red ? "neg" : undefined}>
                  {red
                    ? `Negativo em ${dayLabel(red.date, p.today)}`
                    : lowest && `Menor saldo ${roundMoney(lowest.balance)}`}
                </span>
                {effect && !none(effect.lowest) && (
                  <span className="faint">
                    {roundMoney(Math.abs(effect.lowest))} {effect.lowest < 0 ? "a menos" : "a mais"}
                  </span>
                )}
                <span className="sr-only">: ver a resposta</span>
              </button>,
              peek,
            ))}

      <section id="sim-answer" className="panel sim-answer" aria-labelledby="sim-verdict">
        <div className="sim-head">
          <h2 id="sim-verdict" ref={setVerdictEl} className="sim-verdict">
            {verdict}
          </h2>
          {deltaText && <p className="sim-delta">{deltaText}</p>}
          {heldText && <p className="sim-delta">{heldText}</p>}
          {wayOut && <p className="sim-delta">{wayOut}</p>}
        </div>
        <PacePicker r={r} noSettings={noSettings} onPick={setChosen} />
        <dl className="figures">
          {endMonth && (
            <div>
              <dt>Fim de {endLabel}</dt>
              <dd className={endMonth.endSim < 0 ? "neg" : undefined}>
                {roundMoney(endMonth.endSim)}
              </dd>
              {r.pace !== "planilha" && endMonth.endSim !== endMonth.endSheet && (
                <dd className="fig-note">Planilha: {roundMoney(endMonth.endSheet)}</dd>
              )}
            </div>
          )}
          <div className="end">
            <dt>Dá para guardar</dt>
            <dd>{saving ? roundMoney(saving.amount) : "Nada"}</dd>
            <dd className="fig-note">
              {saving
                ? `${saving.date === p.today ? "hoje" : `em ${dayLabel(saving.date, p.today)}`}${
                    r.pace === "planilha" ? ", sem o gasto do dia a dia" : ""
                  }`
                : red
                  ? "o saldo fica negativo"
                  : "sobra pouco no menor saldo"}
            </dd>
            {saving && (
              <dd className="fig-note">Depois, menor saldo {roundMoney(saving.leftAtLowest)}</dd>
            )}
          </div>
        </dl>
        <SimChart
          days={r.days}
          same={same}
          mark={red ?? lowest}
          fit={r.pace !== "planilha"}
          from={r.paceFrom}
          label={`Saldo de hoje até ${dayLabel(r.end, p.today)}. ${verdict}`}
        />
        <MonthTable r={r} same={same} today={p.today} />
      </section>

      <section className="panel sim-changes" aria-labelledby="sim-changes">
        <h2 id="sim-changes" ref={changesTitle} tabIndex={-1}>
          E se…
        </h2>
        {rows.length === 0 ? (
          <p className="hint">
            Uma compra parcelada, um freela, um empréstimo: veja como fica antes de decidir. Um
            empréstimo é uma Entrada e uma Saída por vários meses.
          </p>
        ) : (
          <ul className="sim-rows">
            {rows.map((row) => (
              <ChangeRow
                key={row.key}
                row={row}
                r={r}
                effect={effectOf(row.key)}
                alone={used.length > 1}
                focus={focusKey.current === row.key}
                onFocused={() => {
                  focusKey.current = null;
                }}
                onChange={(patch) => edit(row.key, patch)}
                onRemove={() => remove(row.key)}
              />
            ))}
          </ul>
        )}
        {refused.length > 0 && (
          <p className="hint error" role="alert">
            Não consegui somar{" "}
            {[...new Set(refused.map((a) => KIND_NOUN[a.kind].toLowerCase()))].join(" e ")}:{" "}
            {refused.length > 1 ? "ficaram" : "ficou"} de fora. Confira o valor e o dia.
          </p>
        )}
        <div className="sim-add">
          {(["compra", "entrada", "saida"] as const)
            .filter((k) => k !== "compra" || r.card)
            .map((k) => (
              <button
                key={k}
                type="button"
                className="ghost"
                disabled={rows.length >= MAX_CHANGES}
                onClick={() => add(k)}
              >
                <IconPlus />
                {KIND_LABEL[k]}
              </button>
            ))}
        </div>
        {rows.length >= MAX_CHANGES ? (
          <p className="hint">Até {MAX_CHANGES} mudanças de cada vez.</p>
        ) : (
          !r.card && (
            <p className="hint">
              Para simular uma compra, escolha o cartão principal em{" "}
              <Link to="/ajustes">Ajustes</Link>.
            </p>
          )
        )}
      </section>
    </>
  );
};

/**
 * Chips that pick one: native radios, so the group is one Tab stop and the arrows move inside it,
 * dressed as the app's chips.
 */
const ChipRadios = <T extends string | number>({
  label,
  options,
  value,
  onPick,
  className,
  describedBy,
}: {
  label: string;
  options: readonly { readonly value: T; readonly label: string }[];
  value: T;
  onPick: (v: T) => void;
  className: string;
  describedBy?: string;
}) => {
  const name = useId();
  return (
    <fieldset
      className={`chip-radios ${className}`}
      aria-label={label}
      aria-describedby={describedBy}
    >
      {options.map((o) => (
        <label key={String(o.value)} className="chip-radio">
          <input
            type="radio"
            name={name}
            checked={o.value === value}
            onChange={() => onPick(o.value)}
          />
          <span>{o.label}</span>
        </label>
      ))}
    </fieldset>
  );
};

/**
 * The premise next to the answer that depends on it: the spending of the day to day the months
 * ahead take, in one line, and how it is counted for whoever opens it.
 */
const PacePicker = ({
  r,
  noSettings,
  onPick,
}: {
  r: ScenarioView;
  noSettings: boolean;
  onPick: (p: Pace) => void;
}) => {
  const id = useId();
  const { today, pace, monthly, spends } = r;
  const now = Number(today.slice(5, 7));
  const from = `${capitalize(monthName(now))} segue a planilha; de ${monthName((now % 12) + 1)} em diante`;
  const { teto, media } = spends;
  const line =
    pace === "planilha" || monthly === null
      ? "Só o que já está na planilha: os meses à frente ainda sem o gasto do dia a dia."
      : pace === "teto"
        ? `${from}, ${roundMoney(monthly)} por mês em cartões e Pix.`
        : `${from}, ${roundMoney(monthly)} por mês, a média dos últimos 3 meses.`;
  const inside =
    "As faturas que já estão na planilha ficam dentro dele: cada mês só gasta o que falta para chegar lá. Por isso uma compra parcelada que cabe não mexe no saldo; ela deixa menos para o resto do mês.";
  const how =
    pace === "planilha" || monthly === null
      ? "Os meses à frente só têm o que já está lançado: salário, contas fixas, parcelas. O gasto do dia a dia ainda não está neles, então parecem melhores do que vão ser. Teto e Média somam esse gasto."
      : pace === "teto"
        ? `O teto é o que você definiu em Ajustes para cartões e Pix. ${inside}${
            media === null || media === monthly
              ? ""
              : media > monthly
                ? ` Nos últimos 3 meses a média foi ${roundMoney(media)}, acima dele: a Média é a conta mais cautelosa.`
                : ` Nos últimos 3 meses a média foi ${roundMoney(media)}, abaixo dele: esta é a conta mais cautelosa.`
          }`
        : `A média soma o diário real e as faturas dos seus cartões nos 3 últimos meses completos. ${inside.replace("dentro dele", "dentro dela")}${
            teto === null || teto === monthly
              ? ""
              : monthly > teto
                ? ` Passa do teto de ${roundMoney(teto)}: esta é a conta mais cautelosa.`
                : ` Fica abaixo do teto de ${roundMoney(teto)}: o Teto é a conta mais cautelosa.`
          }`;
  return (
    <div className="sim-pace">
      {r.paces.length > 1 && (
        <ChipRadios
          label="Gasto do dia a dia"
          className="sim-pace-pick"
          options={r.paces.map((k) => ({ value: k, label: PACE_LABEL[k] }))}
          value={pace}
          onPick={onPick}
          describedBy={`${id}-line`}
        />
      )}
      <p id={`${id}-line`} className="hint">
        {line}
      </p>
      {noSettings ? (
        <p className="hint">
          Não consegui ler seus Ajustes, então o teto ficou de fora. Volte daqui a pouco.
        </p>
      ) : (
        teto === null && (
          <p className="hint">
            Para ver gastando o teto, defina o teto do mês em <Link to="/ajustes">Ajustes</Link>.
          </p>
        )
      )}
      <details className="formula sim-how">
        <summary>
          <IconChevron />
          Como calculei
        </summary>
        <p>{how}</p>
      </details>
    </div>
  );
};

/** Hoje's "Ainda cabem" names what it measures: the bills it counts, or the month. */
const figureScope = (cs: NonNullable<ScenarioView["canSpend"]>, today: string) =>
  cs.mode === "month"
    ? `em ${monthName(Number(today.slice(5, 7)))}`
    : `${cs.mode === "cards" ? "nas faturas" : "na fatura"} de ${monthName(Number(cs.due.slice(5, 7)))}`;

const ChangeRow = ({
  row,
  r,
  effect,
  alone,
  focus,
  onFocused,
  onChange,
  onRemove,
}: {
  row: Row;
  r: ScenarioView;
  /** This change on its own; null while it says too little to count. */
  effect: ChangeEffect | null;
  /** Other changes count too: the row says what it does by itself. */
  alone: boolean;
  focus: boolean;
  onFocused: () => void;
  onChange: (patch: Partial<Row>) => void;
  onRemove: () => void;
}) => {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!focus) return;
    input.current?.focus();
    onFocused();
  }, [focus, onFocused]);
  const { today, end, card, due } = r;
  const amount = amountOf(row.typed);
  const typed = row.typed.trim();
  const tooBig = PT_MONEY.test(typed) && (toCents(typed) ?? 0) > MAX_AMOUNT;
  // A zero on its way to "0,50" is not wrong yet: it only does not count.
  const bad = typed !== "" && (!PT_MONEY.test(typed) || tooBig);
  const compra = row.kind === "compra";
  const title = compra ? `Compra${card ? ` no ${card}` : ""}` : KIND_LABEL[row.kind];
  const outOfRange = !compra && (row.date < today || row.date > end);
  const fig = compra && r.canSpend ? simFigure(r.canSpend, amount ? r.cycle : null) : null;
  const day = Number(row.date.slice(8, 10));
  const endLabel = monthOf(end.slice(0, 7), today);
  const lastLabel = (() => {
    const m = r.months.at(-1);
    return m ? monthLabel(m.year, m.month, today) : endLabel;
  })();
  const held = effect?.inPace ?? null;
  // One fact a line: when it starts, what the pace holds, what the sheet reaches, its own effect.
  const notes: { text: string; neg?: boolean }[] = [];
  if (compra) {
    if (due)
      notes.push({
        text: `${row.count > 1 ? "1ª parcela" : "Sai da conta"} em ${dayLabel(due, today)}.`,
      });
    if (held)
      notes.push({
        text:
          held.count === 1
            ? `${effect?.of === 1 ? "Fica" : "1 parcela fica"} ${PACE_INSIDE[r.pace]} de ${monthOf(held.until, today)}: ${roundMoney(held.amount)} a menos para o resto do mês.`
            : `${held.count === effect?.of ? `As ${held.count} parcelas ficam` : `${held.count} parcelas ficam`} ${PACE_INSIDE[r.pace]} até ${monthOf(held.until, today)}: ${roundMoney(held.perMonth)} a menos por mês para o resto.`,
      });
    if (fig && r.canSpend)
      notes.push({
        text: `${fig.label} ${roundMoney(fig.amount)} ${figureScope(r.canSpend, today)}.`,
        neg: fig.over,
      });
  } else if (outOfRange) {
    notes.push({ text: `Escolha um dia de hoje até ${dayLabel(end, today)}.` });
  } else if (row.count > 1) {
    notes.push({ text: `Todo dia ${day}, ${row.count} meses seguidos.` });
  }
  if (effect && effect.counted < effect.of)
    notes.push({
      text: `A planilha vai até ${lastLabel}: ${effect.counted} de ${effect.of} ${compra ? "parcelas entram" : "entram"} na conta.`,
    });
  if (effect && alone) notes.push({ text: deltaSentence(effect, lastLabel, "Sozinha,", false) });
  const choices = compra
    ? PARCELS.map((n) => ({ value: n, label: n === 1 ? "À vista" : `${n}×` }))
    : REPEATS.map((n) => ({ value: n, label: n === 1 ? "Uma vez" : `${n} meses` }));
  return (
    <li className="sim-row">
      <h3>{title}</h3>
      <div className={compra ? "sim-row-fields one" : "sim-row-fields"}>
        <label className="field" htmlFor={`${id}-v`}>
          <span className="sr-only">{title}: </span>Valor
          <span className="affix big">
            <span aria-hidden="true">R$</span>
            <input
              ref={input}
              id={`${id}-v`}
              inputMode="decimal"
              autoComplete="off"
              maxLength={16}
              placeholder="0,00"
              value={row.typed}
              aria-invalid={bad || undefined}
              aria-describedby={bad ? `${id}-err` : notes.length > 0 ? `${id}-note` : undefined}
              onChange={(e) => onChange({ typed: e.target.value })}
            />
          </span>
        </label>
        {!compra && (
          <label className="field">
            Dia
            <input
              type="date"
              min={today}
              max={end}
              value={row.date}
              aria-invalid={outOfRange || undefined}
              aria-describedby={notes.length > 0 ? `${id}-note` : undefined}
              onChange={(e) => onChange({ date: e.target.value })}
            />
          </label>
        )}
      </div>
      {bad && (
        <p id={`${id}-err`} className="hint error">
          {tooBig ? "Valor alto demais para simular." : "Use um valor como 1.500,00."}
        </p>
      )}
      <ChipRadios
        label={compra ? "Parcelas" : "Repetir"}
        className={compra ? "sim-parcels" : "sim-repeat"}
        options={choices}
        value={row.count}
        onPick={(n) => onChange({ count: n })}
      />
      {notes.length > 0 && (
        <p
          id={`${id}-note`}
          className={outOfRange ? "hint error sim-row-note" : "hint sim-row-note"}
        >
          {notes.map((n) => (
            <span key={n.text} className={n.neg ? "neg" : undefined}>
              {n.text}
            </span>
          ))}
        </p>
      )}
      {/* Last in the order, so Tab meets the value first; drawn at the row's top right. */}
      <button
        type="button"
        className="icon sim-remove"
        aria-label={`Tirar ${title.charAt(0).toLowerCase()}${title.slice(1)}`}
        onClick={onRemove}
      >
        <IconClose />
      </button>
    </li>
  );
};

/** Every month's end, the chart in numbers: what a screen reader and a careful look read. */
const MonthTable = ({ r, same, today }: { r: ScenarioView; same: boolean; today: string }) => (
  <details className="formula sim-months">
    <summary>
      <IconChevron />
      Mês a mês
    </summary>
    <table>
      <thead>
        <tr>
          <th scope="col">Fim de</th>
          {!same && <th scope="col">Planilha</th>}
          <th scope="col">{same ? "Saldo" : "Simulação"}</th>
        </tr>
      </thead>
      <tbody>
        {r.months.map((m) => (
          <tr key={`${m.year}-${m.month}`}>
            <th scope="row">{monthLabel(m.year, m.month, today)}</th>
            {!same && (
              <td className={m.endSheet < 0 ? "neg" : undefined}>{roundMoney(m.endSheet)}</td>
            )}
            <td className={m.endSim < 0 ? "neg" : undefined}>{roundMoney(m.endSim)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </details>
);
