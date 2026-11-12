import { type Cents, type Change, type LocalDate, MAX_CHANGES, type Pace } from "@neko/engine";
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
import { Skeleton, WithProjection } from "../useProjection.tsx";

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
/** How each answer starts, so the premise is never in another panel than the number. */
const PACE_LEAD: Record<Pace, string> = {
  planilha: "Só com a planilha",
  teto: "Gastando o teto",
  media: "Gastando a média",
};
const KIND_LABEL: Record<Kind, string> = { compra: "Compra", entrada: "Entrada", saida: "Saída" };

const monthLabel = (year: number, month: number, today: string) =>
  `${monthName(month).slice(0, 3)}${String(year) === today.slice(0, 4) ? "" : ` ${year}`}`;

/** The typed amount in cents, or null while it is empty, malformed or past any plan. */
const amountOf = (typed: string): number | null => {
  const t = typed.trim();
  if (!PT_MONEY.test(t)) return null;
  const c = toCents(t);
  return c && c <= MAX_AMOUNT ? c : null;
};

/** The rows that say enough to simulate: an amount, and a day from today on. */
const changesOf = (rows: readonly Row[], today: string, card: boolean): Change[] =>
  rows.flatMap((r): Change[] => {
    const amount = amountOf(r.typed);
    if (!amount) return [];
    if (r.kind === "compra")
      return card ? [{ kind: "compra", amount: amount as Cents, count: r.count }] : [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date) || r.date < today) return [];
    return [{ kind: r.kind, amount: amount as Cents, date: r.date as LocalDate, months: r.count }];
  });

/** "As mudanças tiram R$ 300 do menor saldo e R$ 1.800 do fim de dez 2027." */
const deltaSentence = (lowest: number, end: number, endLabel: string) => {
  const part = (d: number, what: string, verb: boolean) =>
    d === 0
      ? `não mexem no ${what}`
      : d < 0
        ? `${verb ? "tiram " : ""}${roundMoney(-d)} do ${what}`
        : `${verb ? "somam " : ""}${roundMoney(d)} ao ${what}`;
  const sameWay = Math.sign(lowest) === Math.sign(end) && lowest !== 0;
  return `As mudanças ${part(lowest, "menor saldo", true)} e ${part(end, `fim de ${endLabel}`, !sameWay)}.`;
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
        <WithProjection>{(data) => <Settled data={data} peek={peek} />}</WithProjection>
      </div>
    </>
  );
};

/** Ajustes comes first: the ceiling decides where the answer starts, so it never flips. */
const Settled = ({ data, peek }: { data: ProjectionResponse; peek: HTMLElement | null }) => {
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  if (settings.isPending) return <Skeleton />;
  return (
    <Sandbox
      data={data}
      ceiling={(settings.data?.cycleBudget ?? null) as Cents | null}
      peek={peek}
    />
  );
};

const Sandbox = ({
  data,
  ceiling,
  peek,
}: {
  data: ProjectionResponse;
  ceiling: Cents | null;
  peek: HTMLElement | null;
}) => {
  const p = data.projection;
  const [chosen, setChosen] = useState<Pace | null>(null);
  const [rows, setRows] = useState<readonly Row[]>([]);
  const next = useRef(0);
  const focusKey = useRef<number | null>(null);
  const changesTitle = useRef<HTMLHeadingElement>(null);
  const [head, setHead] = useState<HTMLElement | null>(null);
  const [headSeen, setHeadSeen] = useState(true);
  useEffect(() => {
    if (!head || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setHeadSeen(e?.isIntersecting ?? true), {
      rootMargin: "-72px 0px 0px 0px",
    });
    io.observe(head);
    return () => io.disconnect();
  }, [head]);

  const changes = changesOf(
    rows,
    p.today,
    p.cards.some((c) => c.usual),
  );
  const ask = { pace: chosen ?? undefined, changes };
  let r: ScenarioView | null = null;
  let dropped = false;
  try {
    r = scenarioView(data, ceiling, ask);
  } catch {
    // A change the engine refuses never takes the screen with it: the answer without them.
    try {
      r = scenarioView(data, ceiling, { ...ask, changes: [] });
      dropped = changes.length > 0;
    } catch {
      r = null;
    }
  }

  const lead = r ? PACE_LEAD[r.pace] : "";
  const red = r?.firstNegative ?? null;
  const lowest = r?.lowest ?? null;
  const endMonth = r?.months.at(-1);
  const endLabel = r && endMonth ? monthLabel(endMonth.year, endMonth.month, p.today) : "";
  const verdict = !r
    ? ""
    : red
      ? `${lead}, fica negativo em ${dayLabel(red.date, p.today)}.`
      : lowest
        ? `${lead}, o menor saldo é ${roundMoney(lowest.balance)}, em ${dayLabel(lowest.date, p.today)}.`
        : "";
  const delta =
    r?.base && lowest && endMonth
      ? { lowest: lowest.balance - r.base.lowest, end: endMonth.endSim - r.base.end }
      : null;
  const deltaText = delta ? deltaSentence(delta.lowest, delta.end, endLabel) : "";
  const status = useSettled(`${verdict} ${deltaText}`.trim());

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
        !headSeen &&
        createPortal(
          <button type="button" className="sim-peek" onClick={scrollToAnswer}>
            <span className={red ? "neg" : undefined}>
              {red
                ? `Negativo em ${dayLabel(red.date, p.today)}`
                : lowest && `Menor saldo ${roundMoney(lowest.balance)}`}
            </span>
            {delta && delta.lowest !== 0 && (
              <span className="faint">
                {roundMoney(Math.abs(delta.lowest))} {delta.lowest < 0 ? "a menos" : "a mais"}
              </span>
            )}
            <span className="sr-only">: ver a resposta</span>
          </button>,
          peek,
        )}

      <section id="sim-answer" className="panel sim-answer" aria-labelledby="sim-verdict">
        <div ref={setHead} className="sim-head">
          <h2 id="sim-verdict" className="sim-verdict">
            {verdict}
          </h2>
          {deltaText && <p className="sim-delta">{deltaText}</p>}
        </div>
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
                ? saving.date === p.today
                  ? "hoje"
                  : `em ${dayLabel(saving.date, p.today)}`
                : red
                  ? "o saldo fica negativo"
                  : "sobra pouco no menor saldo"}
            </dd>
          </div>
        </dl>
        <SimChart
          days={r.days}
          same={same}
          mark={red ?? lowest}
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
        {dropped && (
          <p className="hint error" role="alert">
            Não consegui somar essas mudanças. Confira os valores e os dias.
          </p>
        )}
        <div className="sim-add">
          {(["compra", "entrada", "saida"] as const)
            .filter((k) => k !== "compra" || r.card)
            .map((k) => (
              <button
                key={k}
                type="button"
                className="ghost small"
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

      <PacePicker r={r} onPick={setChosen} />
    </>
  );
};

/** The spending of the day to day the months ahead take, what that premise means, and when. */
const PacePicker = ({ r, onPick }: { r: ScenarioView; onPick: (p: Pace) => void }) => {
  const id = useId();
  const { today, pace, monthly, spends } = r;
  const now = Number(today.slice(5, 7));
  const rest = `${capitalize(monthName(now))} segue a planilha. De ${monthName((now % 12) + 1)} em diante`;
  const { teto, media } = spends;
  const premise =
    pace === "planilha" || monthly === null
      ? "Só o que já está na planilha. Os meses à frente ainda não têm o gasto do dia a dia, então parecem melhores do que vão ser."
      : pace === "teto"
        ? `${rest}, cada mês gasta o teto de ${roundMoney(monthly)} em cartões e Pix, com as faturas que já estão na planilha dentro dele.${
            media === null || media === monthly
              ? ""
              : media > monthly
                ? ` Nos últimos 3 meses a média foi ${roundMoney(media)}, acima dele: a Média é a conta mais cautelosa.`
                : ` Nos últimos 3 meses a média foi ${roundMoney(media)}, abaixo dele: esta é a conta mais cautelosa.`
          }`
        : `${rest}, cada mês gasta ${roundMoney(monthly)}, a média dos últimos 3 meses, com as faturas que já estão na planilha dentro dela.${
            teto === null || teto === monthly
              ? ""
              : monthly > teto
                ? ` Passa do teto de ${roundMoney(teto)}: esta é a conta mais cautelosa.`
                : ` Fica abaixo do teto de ${roundMoney(teto)}: o Teto é a conta mais cautelosa.`
          }`;
  return (
    <section className="panel sim-pace" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Gasto do dia a dia</h2>
      {r.paces.length > 1 && (
        <fieldset className="sim-pace-pick" aria-labelledby={`${id}-h`}>
          {r.paces.map((k) => (
            <button
              key={k}
              type="button"
              className="chip-button"
              aria-pressed={pace === k}
              aria-describedby={pace === k ? `${id}-premise` : undefined}
              onClick={() => onPick(k)}
            >
              {PACE_LABEL[k]}
            </button>
          ))}
        </fieldset>
      )}
      <p id={`${id}-premise`} className="hint">
        {premise}
      </p>
      {teto === null && (
        <p className="hint">
          Para ver gastando o teto, defina o teto do mês em <Link to="/ajustes">Ajustes</Link>.
        </p>
      )}
    </section>
  );
};

const ChangeRow = ({
  row,
  r,
  focus,
  onFocused,
  onChange,
  onRemove,
}: {
  row: Row;
  r: ScenarioView;
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
  const choices = compra ? PARCELS : REPEATS;
  const day = Number(row.date.slice(8, 10));
  return (
    <li className="sim-row">
      <div className="sim-row-head">
        <h3>{title}</h3>
        <button
          type="button"
          className="icon"
          aria-label={`Tirar ${title.charAt(0).toLowerCase()}${title.slice(1)}`}
          onClick={onRemove}
        >
          <IconClose />
        </button>
      </div>
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
              aria-describedby={bad ? `${id}-err` : undefined}
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
              aria-describedby={`${id}-note`}
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
      <fieldset
        className={compra ? "parcels sim-parcels" : "sim-repeat"}
        aria-label={compra ? "Parcelas" : "Repetir"}
      >
        {choices.map((n) => (
          <button
            key={n}
            type="button"
            className="chip-button"
            aria-pressed={row.count === n}
            onClick={() => onChange({ count: n })}
          >
            {compra ? (n === 1 ? "À vista" : `${n}×`) : n === 1 ? "Uma vez" : `${n} meses`}
          </button>
        ))}
      </fieldset>
      <p id={`${id}-note`} className={outOfRange ? "hint error sim-row-note" : "hint sim-row-note"}>
        {compra ? (
          <>
            {fig && (
              <span className={fig.over ? "neg" : undefined}>
                {fig.label} {roundMoney(fig.amount)}
              </span>
            )}
            {due && (
              <span>
                {row.count > 1 ? "1ª parcela" : "Sai da conta"} em {dayLabel(due, today)}
              </span>
            )}
          </>
        ) : outOfRange ? (
          `Escolha um dia de hoje até ${dayLabel(end, today)}.`
        ) : row.count > 1 ? (
          `Todo dia ${day}, ${row.count} meses seguidos.`
        ) : row.date === today ? (
          "Hoje."
        ) : (
          `Em ${dayLabel(row.date, today)}.`
        )}
      </p>
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
            <th scope="row">{capitalize(monthLabel(m.year, m.month, today))}</th>
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
