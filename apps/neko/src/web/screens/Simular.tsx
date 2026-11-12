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
import { mixNumber, reducedMotion, useGlide, useMorph } from "../useMorph.ts";
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
const PACE_IN: Record<Pace, string> = {
  planilha: "",
  teto: "no teto",
  media: "na média",
};
/** What the bills alone already take, in the months the day to day gets nothing. */
const PACE_ALL: Record<Pace, string> = {
  planilha: "",
  teto: "o teto todo",
  media: "a média toda",
};
const KIND_LABEL: Record<Kind, string> = { compra: "Compra", entrada: "Entrada", saida: "Saída" };
/** One key adds each kind, as the tabs have theirs; never while typing a value. */
const KIND_KEY: Record<Kind, string> = { compra: "C", entrada: "E", saida: "S" };
/** One change on its own is the subject of the answer's sentence. */
const KIND_NOUN: Record<Kind, string> = {
  compra: "A compra",
  entrada: "A entrada",
  saida: "A saída",
};

/**
 * "dez", or "dez 2027" when it is not this year: the same month in every place on the screen,
 * never broken across two lines.
 */
const monthLabel = (year: number, month: number, today: string) =>
  `${monthName(month).slice(0, 3)}${String(year) === today.slice(0, 4) ? "" : `\u00a0${year}`}`;
/** "12 mai 2027" in one piece: a date never breaks across lines in a sentence. */
const dayOf = (iso: string, today: string) => dayLabel(iso, today).replaceAll(" ", "\u00a0");
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
 * "As mudanças tiram R$ 300 do menor saldo e R$ 1.800 do saldo final", with no period, so the
 * caller can go on. With one change it is that change, in the singular: "A compra tira…", and
 * "Sozinha, tira…" in its own row. The same amount on both reads once: "tira R$ 300 do menor saldo
 * e do saldo final"; nothing at all is "não mexe no saldo".
 */
const deltaSentence = (e: Effect, who: string, plural: boolean) => {
  const verb = (pl: string, sg: string) => (plural ? pl : sg);
  const low = Math.round(e.lowest / 100);
  if (none(e.lowest) && none(e.end)) return `${who} ${verb("não mexem", "não mexe")} no saldo`;
  if (low === Math.round(e.end / 100))
    return low < 0
      ? `${who} ${verb("tiram", "tira")} ${roundMoney(-e.lowest)} do menor saldo e do saldo final`
      : `${who} ${verb("somam", "soma")} ${roundMoney(e.lowest)} ao menor saldo e ao saldo final`;
  const part = (d: number, what: string, withVerb: boolean) =>
    none(d)
      ? `${verb("não mexem", "não mexe")} no ${what}`
      : d < 0
        ? `${withVerb ? `${verb("tiram", "tira")} ` : ""}${roundMoney(-d)} do ${what}`
        : `${withVerb ? `${verb("somam", "soma")} ` : ""}${roundMoney(d)} ao ${what}`;
  const sameWay = Math.sign(e.lowest) === Math.sign(e.end) && !none(e.lowest) && !none(e.end);
  return `${who} ${part(e.lowest, "menor saldo", true)} e ${part(e.end, "saldo final", !sameWay)}`;
};

/**
 * "em nov", "em nov e jan 2027" or "em 7 meses até jul 2027": the months a premise leaves bare,
 * short enough to read at a glance and never a count that reads as wrong arithmetic.
 */
const monthsSpan = (months: readonly string[], today: string) => {
  const first = months[0];
  const last = months.at(-1);
  if (!first || !last) return "";
  if (months.length === 1) return `em ${monthOf(first, today)}`;
  if (months.length === 2) return `em ${monthOf(first, today)} e ${monthOf(last, today)}`;
  return `em ${months.length} meses até ${monthOf(last, today)}`;
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

/**
 * A figure that counts to its new value as the chart moves to it, and up from zero the first
 * time it shows, as Hoje's figures roll in. Red while the count is below zero.
 */
const Count = ({ cents }: { cents: number }) => {
  const { from, to, e } = useMorph(cents, String(cents), mixNumber, 0);
  const shown = mixNumber(from, to, e);
  return <span className={shown < 0 ? "neg" : undefined}>{roundMoney(shown)}</span>;
};

/**
 * A line that comes and goes with the answer: it opens and closes by height, keeping its last
 * words while it closes, so what is under it glides instead of jumping.
 */
const Reveal = ({
  text,
  slot,
  id,
  className,
}: {
  text: string;
  /** The wrapper's own class, where the line keeps a place of its own in the panel. */
  slot?: string;
  id?: string;
  className: string;
}) => {
  const last = useRef(text);
  if (text) last.current = text;
  return (
    <div
      className={slot ? `reveal ${slot}` : "reveal"}
      data-open={text ? "" : undefined}
      aria-hidden={text ? undefined : true}
    >
      <p id={id} className={className}>
        {last.current}
      </p>
    </div>
  );
};

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
  // Esc inside the screen stepped out to the title: one more leaves, and the bar says so.
  const [escaped, setEscaped] = useState(false);
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
        <h1 ref={title} tabIndex={-1} onBlur={() => setEscaped(false)}>
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
          setEscaped(true);
          title.current?.focus();
        }}
      >
        <WithProjection loading={<SimSkeleton />}>
          {(data) => <Settled data={data} peek={peek} escaped={escaped} />}
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
const Settled = ({
  data,
  peek,
  escaped,
}: {
  data: ProjectionResponse;
  peek: HTMLElement | null;
  escaped: boolean;
}) => {
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  // A retry of a failed read is pending again: the what-ifs stay on screen while it runs, and only
  // the very first read shows the skeleton. The count of errors survives the retry.
  const failedBefore = settings.errorUpdateCount > 0;
  if (settings.isPending && !failedBefore) return <SimSkeleton />;
  return (
    <Sandbox
      data={data}
      ceiling={(settings.data?.cycleBudget ?? null) as Cents | null}
      settingsFailed={
        settings.data === undefined && failedBefore
          ? { retrying: settings.isFetching, retry: () => void settings.refetch() }
          : null
      }
      peek={peek}
      escaped={escaped}
    />
  );
};

/** Ajustes could not be read: no ceiling to offer, the screen says why and tries again. */
interface SettingsFailed {
  readonly retrying: boolean;
  readonly retry: () => void;
}

const Sandbox = ({
  data,
  ceiling,
  settingsFailed,
  peek,
  escaped,
}: {
  data: ProjectionResponse;
  ceiling: Cents | null;
  settingsFailed: SettingsFailed | null;
  peek: HTMLElement | null;
  /** Esc took the focus to the title: the bar warns what one more press does. */
  escaped: boolean;
}) => {
  const p = data.projection;
  const [chosen, setChosen] = useState<Pace | null>(null);
  const [rows, setRows] = useState<readonly Row[]>([]);
  const next = useRef(0);
  const focusKey = useRef<number | null>(null);
  const changesTitle = useRef<HTMLHeadingElement>(null);
  const [verdictEl, setVerdictEl] = useState<HTMLElement | null>(null);
  // Ajustes read again after "Tentar de novo": the keys land on the answer it changed.
  const retried = useRef(false);
  const failedNow = settingsFailed !== null;
  useEffect(() => {
    if (failedNow || !retried.current) return;
    retried.current = false;
    verdictEl?.focus();
  }, [failedNow, verdictEl]);
  const [verdictSeen, setVerdictSeen] = useState(true);
  // The row just taken out, and where it was, until the next change: one tap puts it back.
  const [removed, setRemoved] = useState<{ row: Row; at: number } | null>(null);
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
  const edge = atEdge ? ", no último mês da planilha" : "";
  // Months whose bills take the whole pace leave the day to day out: the answer says it is the best.
  const best = !!r && r.full.length > 0;
  // In the red the answer is when, and how deep; otherwise the lowest balance and its day.
  const verdict = !r
    ? ""
    : red && lowest
      ? `${lead}, ${best ? "mesmo no melhor caso " : ""}fica negativo em ${dayOf(red.date, p.today)} e chega a ${roundMoney(lowest.balance)}${best ? "" : edge}.`
      : lowest
        ? `${lead}, ${best ? "no melhor caso " : ""}o menor saldo é ${roundMoney(lowest.balance)}, em ${dayOf(lowest.date, p.today)}${edge}.`
        : "";
  const single = used.length === 1 ? used[0] : undefined;
  // One quiet line under the answer: what the changes did to it. Parcels the pace holds leave the
  // balance as it was, and the line says why; each row says what they take from the day to day.
  const headText = (() => {
    if (!r?.effect || !endMonth) return "";
    const e = r.effect;
    const delta = deltaSentence(e, single ? KIND_NOUN[single.kind] : "As mudanças", !single);
    const held = r.effects.some((x) => (x.inPace?.amount ?? 0) > 0);
    return none(e.lowest) && none(e.end) && held
      ? `${delta}: as parcelas cabem ${PACE_IN[r.pace]}.`
      : `${delta}.`;
  })();
  const status = useSettled([verdict, headText].filter(Boolean).join(" "));
  const answerKind = `${r?.pace ?? ""}${red ? "-neg" : ""}`;
  const head = useGlide<HTMLDivElement>(answerKind);

  const add = (kind: Kind) => {
    const key = next.current++;
    focusKey.current = key;
    setRemoved(null);
    setRows((rs) => [...rs, { key, kind, typed: "", count: 1, date: p.today }]);
  };
  const edit = (key: number, patch: Partial<Row>) => {
    setRemoved(null);
    setRows((rs) => rs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  };
  const remove = (key: number) => {
    const i = rows.findIndex((x) => x.key === key);
    const row = rows[i];
    if (!row) return;
    // The focus goes to the row next to it, or to the panel's title when it was the last one.
    const near = rows[i - 1] ?? rows[i + 1];
    focusKey.current = near?.key ?? null;
    if (!near) requestAnimationFrame(() => changesTitle.current?.focus());
    setRemoved({ row, at: i });
    setRows((rs) => rs.filter((x) => x.key !== key));
  };
  const undo = () => {
    if (!removed) return;
    const { row, at } = removed;
    focusKey.current = row.key;
    setRemoved(null);
    setRows((rs) => [...rs.slice(0, at), row, ...rs.slice(at)]);
  };

  if (!r || r.days.length < 2)
    return (
      <p className="muted">
        Não há meses à frente na planilha. Crie a aba do próximo ano e volte aqui.
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
      <p className="sim-lead">Planilha lida {readAtLabel(data.sheet.readAt)}. Nada aqui é salvo.</p>
      <p className="sr-only" role="status">
        {status}
      </p>
      {peek &&
        rows.length > 0 &&
        (escaped
          ? createPortal(
              <p className="sim-peek-hint">Esc de novo sai e apaga as mudanças.</p>,
              peek,
            )
          : !verdictSeen &&
            createPortal(
              <button type="button" className="sim-peek" onClick={scrollToAnswer}>
                <span className={red ? "neg" : undefined}>
                  {red
                    ? `Negativo em ${dayOf(red.date, p.today)}`
                    : lowest &&
                      `Menor saldo ${roundMoney(lowest.balance)}${best ? " no melhor caso" : ""}`}
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
        <div ref={head} className="sim-head">
          {/*
           * Another pace, or the red, fades the answer in where the last one was; typing only
           * changes its numbers in place, as the figures count to theirs.
           */}
          <h2 id="sim-verdict" ref={setVerdictEl} className="sim-verdict" tabIndex={-1}>
            <span key={answerKind} className="swap">
              {verdict}
            </span>
          </h2>
          {headText && (
            <p key={answerKind} className="sim-delta swap">
              {headText}
            </p>
          )}
        </div>
        <PacePicker
          r={r}
          settingsFailed={settingsFailed}
          onRetry={() => {
            retried.current = true;
            settingsFailed?.retry();
          }}
          onPick={setChosen}
        />
        <dl className="figures">
          {endMonth && (
            <div>
              <dt>Fim de {endLabel}</dt>
              <dd>
                <Count cents={endMonth.endSim} />
              </dd>
              {r.pace !== "planilha" && endMonth.endSim !== endMonth.endSheet && (
                <dd className="fig-note swap">Planilha: {roundMoney(endMonth.endSheet)}</dd>
              )}
            </div>
          )}
          <div className="end">
            <dt>Dá para guardar</dt>
            <dd>
              {saving ? (
                <Count key="saving" cents={saving.amount} />
              ) : (
                <span key="nada" className="swap">
                  Nada
                </span>
              )}
            </dd>
            <dd className="fig-note">
              {saving
                ? saving.date === p.today
                  ? "hoje"
                  : `em ${dayOf(saving.date, p.today)}`
                : best
                  ? `as faturas usam ${r.pace === "teto" ? "o teto" : "a média"}`
                  : red
                    ? "o saldo fica negativo"
                    : "sobra pouco no menor saldo"}
            </dd>
          </div>
        </dl>
        <Reveal
          slot="sim-after"
          className="hint"
          text={
            saving
              ? `Guardando esse valor, o menor saldo fica em ${roundMoney(saving.leftAtLowest)}.`
              : ""
          }
        />
        <SimChart
          days={r.days}
          same={same}
          mark={red ?? lowest}
          fit={r.pace !== "planilha"}
          from={r.paceFrom}
          label={`Saldo de hoje até ${dayOf(r.end, p.today)}. ${verdict}`}
        />
        <MonthTable r={r} same={same} today={p.today} />
      </section>

      <section className="panel sim-changes" aria-labelledby="sim-changes">
        <h2 id="sim-changes" ref={changesTitle} tabIndex={-1}>
          E se…
        </h2>
        {rows.length === 0 ? (
          <p className="hint">
            Teste antes de decidir: uma compra parcelada, um freela, um empréstimo.
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
        {removed && (
          <p className="sim-undo" role="status">
            {KIND_LABEL[removed.row.kind]} removida.{" "}
            <button type="button" className="text-link" onClick={undo}>
              Desfazer
            </button>
          </p>
        )}
        {refused.length > 0 && (
          <p className="hint error" role="alert">
            {capitalize(
              [...new Set(refused.map((a) => KIND_NOUN[a.kind].toLowerCase()))].join(" e "),
            )}{" "}
            {refused.length > 1 ? "ficaram" : "ficou"} de fora da conta. Confira o valor e o dia.
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
                aria-keyshortcuts={KIND_KEY[k]}
                title={`${KIND_LABEL[k]} (${KIND_KEY[k]})`}
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
  settingsFailed,
  onRetry,
  onPick,
}: {
  r: ScenarioView;
  settingsFailed: SettingsFailed | null;
  onRetry: () => void;
  onPick: (p: Pace) => void;
}) => {
  const id = useId();
  const { today, pace, monthly, spends, full } = r;
  const premise = useGlide<HTMLDivElement>(pace);
  const now = Number(today.slice(5, 7));
  const from = `De ${monthName((now % 12) + 1)} em diante`;
  const { teto, media } = spends;
  const line =
    pace === "planilha" || monthly === null
      ? "Só o que já está lançado, sem o gasto do dia a dia."
      : pace === "teto"
        ? `${from}, ${roundMoney(monthly)} por mês em cartões e Pix.`
        : `${from}, ${roundMoney(monthly)} por mês, a média dos últimos 3 meses.`;
  // Where the bills alone already take the pace, the answer counts nothing else that month.
  const bare =
    monthly !== null && full.length > 0
      ? `Melhor caso: ${monthsSpan(full, today)}, só as faturas já usam ${PACE_ALL[pace]}, sem sobrar nada para o dia a dia.`
      : "";
  // One short idea a line, so the formula reads at a glance even open.
  const current = `${capitalize(monthName(now))} segue só a planilha.`;
  const how: string[] =
    pace === "planilha" || monthly === null
      ? [
          "Só entra o que já está lançado: salário, contas fixas, parcelas.",
          "Falta o gasto do dia a dia, então os meses parecem melhores do que vão ser.",
          "Teto e Média somam esse gasto.",
        ]
      : [
          pace === "teto"
            ? `Teto de ${roundMoney(monthly)} por mês em cartões e Pix, definido em Ajustes.`
            : `Média do diário real mais as faturas dos cartões, nos 3 últimos meses completos.`,
          `As faturas já lançadas saem desses ${roundMoney(monthly)}; o resto fica para o dia a dia.`,
          "Uma parcela que cabe não mexe no saldo: só deixa menos para o dia a dia.",
          current,
          ...(pace === "teto"
            ? media === null || media === monthly
              ? []
              : [
                  media > monthly
                    ? `A média dos últimos 3 meses foi ${roundMoney(media)}, acima do teto: a média é a conta mais cautelosa.`
                    : `A média dos últimos 3 meses foi ${roundMoney(media)}, abaixo do teto: o teto é a conta mais cautelosa.`,
                ]
            : teto === null || teto === monthly
              ? []
              : [
                  monthly > teto
                    ? `A média passa do teto de ${roundMoney(teto)}: é a conta mais cautelosa.`
                    : `A média fica abaixo do teto de ${roundMoney(teto)}: o teto é a conta mais cautelosa.`,
                ]),
        ];
  return (
    <div className="sim-pace">
      {r.paces.length > 1 && (
        <ChipRadios
          label="Gasto do dia a dia"
          className="sim-pace-pick"
          options={r.paces.map((k) => ({ value: k, label: PACE_LABEL[k] }))}
          value={pace}
          onPick={onPick}
          describedBy={bare ? `${id}-line ${id}-bare` : `${id}-line`}
        />
      )}
      <div ref={premise}>
        <p key={line} id={`${id}-line`} className="hint swap">
          {line}
        </p>
      </div>
      <Reveal id={`${id}-bare`} className="hint sim-bare" text={bare} />
      {settingsFailed ? (
        <p className="hint">
          Não consegui ler o teto em Ajustes.{" "}
          <button
            type="button"
            className="text-link"
            // Still focusable while it runs, so the keys stay where they were if it fails again.
            aria-disabled={settingsFailed.retrying || undefined}
            onClick={() => {
              if (!settingsFailed.retrying) onRetry();
            }}
          >
            {settingsFailed.retrying ? "Tentando…" : "Tentar de novo"}
          </button>
        </p>
      ) : (
        teto === null && (
          <p className="hint">
            Defina um teto em <Link to="/ajustes">Ajustes</Link> para simular com ele.
          </p>
        )
      )}
      <details className="formula sim-how">
        <summary>
          <IconChevron />
          Como calculei
        </summary>
        {how.map((h) => (
          <p key={h}>{h}</p>
        ))}
      </details>
    </div>
  );
};

/**
 * What a purchase leaves of the plan it lands on, said as Simular says it: "Ainda cabem R$ 900 no
 * diário de novembro", "Passa R$ 300 do teto das faturas de dezembro".
 */
const fitText = (
  cs: NonNullable<ScenarioView["canSpend"]>,
  fig: { amount: Cents; over: boolean },
  today: string,
) => {
  const plan =
    cs.mode === "month"
      ? `diário de ${monthName(Number(today.slice(5, 7)))}`
      : `${cs.mode === "cards" ? "teto das faturas" : "plano da fatura"} de ${monthName(Number(cs.due.slice(5, 7)))}`;
  return fig.over
    ? `Passa ${roundMoney(fig.amount)} do ${plan}.`
    : `Ainda cabem ${roundMoney(fig.amount)} no ${plan}.`;
};

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
  // A day outside the sheet says only that: no effect next to the error.
  const shown = outOfRange ? null : effect;
  const held = shown?.inPace ?? null;
  // One short idea a line: when it lands and what it leaves of the plan, what the pace takes from
  // the day to day, what it does on its own among others, and when the sheet ends before it does.
  const lines: { text: string; neg?: boolean }[][] = [];
  if (compra) {
    const first: { text: string; neg?: boolean }[] = [];
    if (due)
      first.push({
        text: `${row.count > 1 ? "1ª parcela" : "Sai da conta"} em ${dayOf(due, today)}.`,
      });
    if (fig && r.canSpend) first.push({ text: fitText(r.canSpend, fig, today), neg: fig.over });
    if (first.length > 0) lines.push(first);
  } else if (outOfRange) {
    lines.push([{ text: `Escolha um dia de hoje até ${dayOf(end, today)}.` }]);
  } else if (row.count > 1) {
    lines.push([{ text: `Todo dia ${day}, ${row.count} meses seguidos.` }]);
  }
  if (held)
    lines.push([
      {
        text:
          held.count === 1
            ? `Em ${monthOf(held.until, today)}, o dia a dia perde ${roundMoney(held.amount)}.`
            : `Até ${monthOf(held.until, today)}, o dia a dia perde ${held.perMonth * held.count === held.amount ? "" : "no máximo "}${roundMoney(held.perMonth)} por mês.`,
      },
    ]);
  if (shown && alone) lines.push([{ text: `${deltaSentence(shown, "Sozinha,", false)}.` }]);
  if (shown && shown.counted < shown.of)
    lines.push([
      {
        text: `A planilha vai até ${lastLabel}: ${shown.counted} de ${shown.of} ${compra ? "parcelas entram" : "entram"} na conta.`,
      },
    ]);
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
              aria-describedby={bad ? `${id}-err` : lines.length > 0 ? `${id}-note` : undefined}
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
              aria-describedby={lines.length > 0 ? `${id}-note` : undefined}
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
      {lines.length > 0 && (
        <p
          id={`${id}-note`}
          className={outOfRange ? "hint error sim-row-note" : "hint sim-row-note"}
        >
          {lines.map((line) => (
            <span key={line.map((n) => n.text).join(" ")}>
              {line.map((n, k) => (
                <span key={n.text} className={n.neg ? "neg" : undefined}>
                  {k > 0 ? " " : ""}
                  {n.text}
                </span>
              ))}
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
