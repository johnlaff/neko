import type { Band, DayMove, Saving, ThermoDay } from "@neko/engine";
import { type CSSProperties, type KeyboardEvent, useRef, useState } from "react";
import { ItemName } from "./Figures.tsx";
import { money, monthName, shortDate, signed } from "./format.ts";
import { IconCard, IconIncome, IconReceipt, IconToday } from "./icons.tsx";

const BAND_LABEL: Record<Band, string> = {
  negative: "Negativo",
  attention: "Atenção",
  healthy: "Saudável",
  surplus: "Sobrando",
};
const MOVE_ICON = {
  income: IconIncome,
  bill: IconReceipt,
  card: IconCard,
  diario: IconToday,
} as const;
const moveName = (m: DayMove) => (m.kind === "diario" ? "Diário" : m.description || "Sem detalhe");

/** What moved the picked day's balance, the way the sheet holds it. */
const Moves = ({ moves }: { moves: readonly DayMove[] }) =>
  moves.length === 0 ? (
    <p className="thermo-quiet">Nada entrou nem saiu neste dia.</p>
  ) : (
    <ul className="rows lead thermo-moves">
      {moves.map((m, i) => {
        const Icon = MOVE_ICON[m.kind];
        const income = m.kind === "income";
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: a day can repeat the same line, order is the sheet's
          <li key={`${m.kind}-${m.description}-${i}`}>
            <span className={`avatar${income ? " pos" : ""}`}>
              <Icon />
            </span>
            <span className="name">
              <ItemName text={moveName(m)} />
            </span>
            <span className={`value${income ? " pos" : ""}`}>
              {signed(m.amount, income ? "+" : "−")}
            </span>
          </li>
        );
      })}
    </ul>
  );

const WEEK = [
  ["dom", "D"],
  ["seg", "S"],
  ["ter", "T"],
  ["qua", "Q"],
  ["qui", "Q"],
  ["sex", "S"],
  ["sab", "S"],
] as const;

/**
 * The method's termômetro as a month calendar: each day painted in the band of its balance, the
 * days ahead lighter because they are a forecast. Tap a day to read it. In the month of the next
 * payday it also says how much the flow lets you set aside that day, as the method advises.
 */
export const Thermo = ({
  days,
  year,
  month,
  today,
  saving,
}: {
  days: readonly ThermoDay[];
  year: number;
  month: number;
  today: string;
  saving?: Saving | null;
}) => {
  const todayDay =
    today.slice(0, 7) === `${year}-${String(month).padStart(2, "0")}`
      ? Number(today.slice(8))
      : null;
  const [picked, setPicked] = useState<number | null>(null);
  const shown = days.find((d) => d.day === (picked ?? todayDay)) ?? null;
  const offset = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const mon = monthName(month).slice(0, 3);
  const save =
    saving && saving.date.slice(0, 7) === `${year}-${String(month).padStart(2, "0")}`
      ? saving
      : null;
  const payday = save ? Number(save.date.slice(8)) : null;
  // One tab stop for the whole month (roving tabindex); arrows move by day and week, like the
  // date grid in the ARIA Authoring Practices.
  const grid = useRef<HTMLFieldSetElement>(null);
  const first = days[0]?.day ?? 1;
  const last = days.at(-1)?.day ?? first;
  const focusDay = shown?.day ?? first;
  const move = (e: KeyboardEvent<HTMLButtonElement>, day: number) => {
    const weekday = (offset + day - 1) % 7;
    const to =
      e.key === "ArrowLeft"
        ? day - 1
        : e.key === "ArrowRight"
          ? day + 1
          : e.key === "ArrowUp"
            ? day - 7
            : e.key === "ArrowDown"
              ? day + 7
              : e.key === "Home"
                ? day - weekday
                : e.key === "End"
                  ? day + 6 - weekday
                  : null;
    if (to === null) return;
    e.preventDefault();
    const next = Math.min(last, Math.max(first, to));
    setPicked(next);
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${next}"]`)?.focus();
  };
  return (
    <section className="panel half thermo">
      <div className="panel-head">
        <h2>Termômetro</h2>
        {shown ? (
          <span className="meta" aria-live="polite">
            {shown.day} {mon} ·{" "}
            <strong className={`band-text ${shown.band}`}>{money(shown.balance)}</strong>
          </span>
        ) : (
          <span className="meta">Escolha um dia</span>
        )}
      </div>
      <fieldset
        ref={grid}
        className="thermo-grid"
        aria-label={`Saldo de cada dia de ${monthName(month)}`}
      >
        {WEEK.map(([id, letter]) => (
          <span key={id} className="weekday" aria-hidden="true">
            {letter}
          </span>
        ))}
        {days.map((d, i) => (
          <button
            key={d.day}
            type="button"
            className={`day ${d.band}${d.future ? " future" : ""}${d.day === todayDay ? " today" : ""}${d.day === payday ? " payday" : ""}`}
            style={
              {
                "--n": i,
                ...(i === 0 ? { gridColumnStart: offset + 1 } : {}),
              } as CSSProperties
            }
            aria-pressed={shown?.day === d.day}
            aria-label={`${d.day} ${mon}: ${money(d.balance)}, ${BAND_LABEL[d.band].toLowerCase()}${d.future ? ", previsão" : ""}${d.day === payday ? ", dia de guardar" : ""}`}
            data-day={d.day}
            tabIndex={d.day === focusDay ? 0 : -1}
            onClick={() => setPicked(d.day)}
            onKeyDown={(e) => move(e, d.day)}
          >
            {d.day}
          </button>
        ))}
      </fieldset>
      {picked !== null && shown && <Moves key={shown.day} moves={shown.moves ?? []} />}
      <ul className="thermo-legend" aria-hidden="true">
        {(Object.keys(BAND_LABEL) as Band[]).map((b) => (
          <li key={b}>
            <i className={`swatch ${b}`} />
            {BAND_LABEL[b]}
          </li>
        ))}
        {save && (
          <li>
            <i className="swatch dot" />
            Dia de guardar
          </li>
        )}
      </ul>
      {save && (
        <p className="thermo-save">
          <span>
            Dá para guardar <strong>{money(save.amount)}</strong> no dia {payday}.
          </span>
          <span className="muted">
            Menor saldo até {shortDate(save.until)}: {money(save.leftAtLowest)}
          </span>
        </p>
      )}
    </section>
  );
};
