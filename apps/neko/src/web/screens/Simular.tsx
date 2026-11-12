import {
  type Cents,
  type Change,
  type LocalDate,
  MAX_CHANGES,
  type Pace,
  paceMonthly,
  type ScenarioResult,
} from "@neko/engine";
import { useQuery } from "@tanstack/react-query";
import { useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import { scenarioView } from "../../shared/screens.ts";
import { api, type ProjectionResponse } from "../api.ts";
import { capitalize, dayLabel, money, monthName, roundMoney, toCents } from "../format.ts";
import { IconChevron, IconChevronLeft, IconClose, IconPlus } from "../icons.tsx";
import { simFigure } from "../Pace.tsx";
import { SimChart } from "../SimChart.tsx";
import { WithProjection } from "../useProjection.tsx";

/** How Brazilian stores usually split a card purchase. */
const PARCELS = [1, 2, 3, 6, 10, 12] as const;
/** Money in or out once, or on the same day for a few months (a freela, a loan's parcels). */
const REPEATS = [1, 3, 6, 12] as const;

type Kind = Change["kind"];
interface Row {
  readonly key: number;
  readonly kind: Kind;
  readonly typed: string;
  /** Parcels of a purchase, or months of money in or out. */
  readonly count: number;
  readonly date: string;
}

const PACE_LABEL: Record<Pace, string> = { planilha: "Planilha", teto: "Teto", media: "Média" };
const KIND_LABEL: Record<Kind, string> = { compra: "Compra", entrada: "Entrada", saida: "Saída" };

const monthLabel = (year: number, month: number, today: string) =>
  `${monthName(month).slice(0, 3)}${String(year) === today.slice(0, 4) ? "" : ` ${year}`}`;

/** The rows that say enough to simulate: an amount, and a day from today on. */
const changesOf = (rows: readonly Row[], today: string, last: string): Change[] =>
  rows.flatMap((r): Change[] => {
    const amount = toCents(r.typed);
    if (!amount) return [];
    if (r.kind === "compra") return [{ kind: "compra", amount: amount as Cents, count: r.count }];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date) || r.date < today || r.date > last) return [];
    return [{ kind: r.kind, amount: amount as Cents, date: r.date as LocalDate, months: r.count }];
  });

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
      </header>
      <div className="sim-body">
        <WithProjection>{(data) => <Sandbox data={data} />}</WithProjection>
      </div>
    </>
  );
};

const Sandbox = ({ data }: { data: ProjectionResponse }) => {
  const p = data.projection;
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const ceiling = (settings.data?.cycleBudget ?? null) as Cents | null;
  const usual = p.cards.find((c) => c.usual) ?? null;
  // The sheet's last day: nothing past it to simulate on.
  const last = p.months.at(-1);
  const lastDay = last?.days.at(-1)?.day;
  const end =
    last && lastDay
      ? `${last.year}-${String(last.month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`
      : p.today;
  let averageOk = true;
  try {
    paceMonthly("media", p.months, p.today, null);
  } catch {
    averageOk = false;
  }
  const paces: Pace[] = [
    "planilha",
    ...(ceiling !== null ? (["teto"] as const) : []),
    ...(averageOk ? (["media"] as const) : []),
  ];
  const [chosen, setChosen] = useState<Pace | null>(null);
  const pace = chosen && paces.includes(chosen) ? chosen : ceiling !== null ? "teto" : "planilha";
  const [rows, setRows] = useState<readonly Row[]>([]);
  const next = useRef(0);
  const focusKey = useRef<number | null>(null);

  const changes = changesOf(usual ? rows : rows.filter((r) => r.kind !== "compra"), p.today, end);
  let r: ScenarioResult | null = null;
  try {
    r = scenarioView(data, ceiling, { pace, changes });
  } catch {
    r = null;
  }

  const add = (kind: Kind) => {
    const key = next.current++;
    focusKey.current = key;
    setRows((rs) => [...rs, { key, kind, typed: "", count: 1, date: p.today }]);
  };
  const edit = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const remove = (key: number) => setRows((rs) => rs.filter((x) => x.key !== key));

  if (!r || r.days.length < 2)
    return (
      <p className="muted">
        A planilha termina hoje: não há meses à frente para simular. Abra a aba do próximo ano na
        planilha e volte aqui.
      </p>
    );
  const same = r.days.every((d) => d.sim === d.sheet);
  const endMonth = r.months.at(-1);
  const red = r.firstNegative;
  const lowest = r.lowest;

  return (
    <>
      <p className="sim-lead">Nada aqui muda a planilha. Quando você sai, tudo some.</p>
      <section className="panel sim-answer" aria-labelledby="sim-answer">
        <h2 id="sim-answer" className="sim-verdict" aria-live="polite">
          {red
            ? `Fica negativo em ${dayLabel(red.date, p.today)}.`
            : `Fica no azul até ${dayLabel(end, p.today)}.`}
        </h2>
        <dl className="figures">
          {lowest && (
            <div>
              <dt>Menor saldo</dt>
              <dd className={lowest.balance < 0 ? "neg" : undefined}>
                {roundMoney(lowest.balance)}
              </dd>
              <dd className="fig-note">{dayLabel(lowest.date, p.today)}</dd>
            </div>
          )}
          {endMonth && (
            <div className="end">
              <dt>Fim de {monthLabel(endMonth.year, endMonth.month, p.today)}</dt>
              <dd className={endMonth.endSim < 0 ? "neg" : undefined}>
                {roundMoney(endMonth.endSim)}
              </dd>
              {!same && <dd className="fig-note">Planilha: {roundMoney(endMonth.endSheet)}</dd>}
            </div>
          )}
        </dl>
        {r.saving && (
          <p className="sim-save">
            {r.saving.date === p.today ? "Hoje" : `Em ${dayLabel(r.saving.date, p.today)}`}, dá para
            guardar <strong>{roundMoney(r.saving.amount)}</strong>.
          </p>
        )}
        <SimChart
          days={r.days}
          same={same}
          label={`Saldo de hoje até ${dayLabel(end, p.today)}${
            lowest ? `, o menor em ${dayLabel(lowest.date, p.today)}` : ""
          }.`}
        />
        <MonthTable r={r} same={same} today={p.today} />
      </section>

      <PacePicker
        paces={paces}
        pace={pace}
        onPick={setChosen}
        monthly={r.monthly}
        today={p.today}
      />

      <section className="panel sim-changes" aria-labelledby="sim-changes">
        <h2 id="sim-changes">E se…</h2>
        {rows.length === 0 ? (
          <p className="hint">
            Uma compra parcelada, um freela, um empréstimo: veja como fica antes de decidir.
          </p>
        ) : (
          <ul className="sim-rows">
            {rows.map((row) => (
              <ChangeRow
                key={row.key}
                row={row}
                card={usual?.card.name ?? null}
                due={usual?.cycle.due ?? null}
                r={r}
                cs={p.canSpend}
                today={p.today}
                end={end}
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
        <div className="sim-add">
          {(["compra", "entrada", "saida"] as const)
            .filter((k) => k !== "compra" || usual)
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
      </section>
    </>
  );
};

/** The spending of the day to day the months ahead take, and what that premise means. */
const PacePicker = ({
  paces,
  pace,
  onPick,
  monthly,
  today,
}: {
  paces: readonly Pace[];
  pace: Pace;
  onPick: (p: Pace) => void;
  monthly: Cents | null;
  today: string;
}) => {
  const id = useId();
  const nextMonth = monthName((Number(today.slice(5, 7)) % 12) + 1);
  const premise =
    pace === "planilha" || monthly === null
      ? "Só o que já está na planilha. Os meses à frente ainda não têm o gasto do dia a dia, então parecem melhores do que vão ser."
      : pace === "teto"
        ? `De ${nextMonth} em diante, cada mês gasta o teto de ${roundMoney(monthly)} em cartões e Pix. As faturas que já estão na planilha contam dentro dele.`
        : `De ${nextMonth} em diante, cada mês gasta ${roundMoney(monthly)}, a média dos últimos 3 meses. As faturas que já estão na planilha contam dentro disso.`;
  return (
    <section className="panel sim-pace" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Gasto do dia a dia</h2>
      {paces.length > 1 && (
        <fieldset className="sim-pace-pick" aria-labelledby={`${id}-h`}>
          {paces.map((k) => (
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
      <p id={`${id}-premise`} className="hint" aria-live="polite">
        {premise}
      </p>
    </section>
  );
};

const ChangeRow = ({
  row,
  card,
  due,
  r,
  cs,
  today,
  end,
  focus,
  onFocused,
  onChange,
  onRemove,
}: {
  row: Row;
  card: string | null;
  due: string | null;
  r: ScenarioResult;
  cs: ProjectionResponse["projection"]["canSpend"];
  today: string;
  end: string;
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
  const amount = toCents(row.typed);
  const compra = row.kind === "compra";
  const title = compra ? `Compra${card ? ` no ${card}` : ""}` : KIND_LABEL[row.kind];
  const outOfRange = !compra && (row.date < today || row.date > end);
  const fig = compra && cs ? simFigure(cs, amount ? r.cycle : null) : null;
  const choices = compra ? PARCELS : REPEATS;
  const day = Number(row.date.slice(8, 10));
  return (
    <li className="sim-row">
      <div className="sim-row-head">
        <h3 id={`${id}-t`}>{title}</h3>
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
              placeholder="0,00"
              value={row.typed}
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
              onChange={(e) => onChange({ date: e.target.value })}
            />
          </label>
        )}
      </div>
      <fieldset
        className={compra ? "parcels" : "sim-repeat"}
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
      <p className="hint sim-row-note" aria-live="polite">
        {compra ? (
          <>
            {fig && (
              <span className={fig.over ? "neg" : undefined}>
                {fig.label} {money(fig.amount)}
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
const MonthTable = ({ r, same, today }: { r: ScenarioResult; same: boolean; today: string }) => (
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
