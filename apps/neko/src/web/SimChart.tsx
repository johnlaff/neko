import type { ScenarioDay, ScenarioPoint } from "@neko/engine";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { dayLabel, monthName, roundMoney } from "./format.ts";
import { valuesHidden } from "./privacy.ts";

const HEIGHT = 200;
/** The left side is a gutter for the amounts, so no line ever runs through a label. */
const PAD = { top: 12, right: 8, bottom: 26 } as const;
/** About one label character at 11px Geist, to size the gutter to its longest label. */
const CHAR_PX = 6.2;
/** How long the simulation line takes to move to a new answer; none with reduced motion. */
const MORPH_MS = 260;

/** "20 mil", "−5 mil", "0": an axis reads in thousands of reais, never in cents. */
const axisMoney = (cents: number) => {
  if (valuesHidden()) return cents === 0 ? "0" : "";
  if (cents === 0) return "0";
  const k = Math.round(Math.abs(cents) / 100_000);
  return `${cents < 0 ? "−" : ""}${k.toLocaleString("pt-BR")} mil`;
};

/** About four round steps that cover the range, zero always one of them. */
const ticksFor = (lo: number, hi: number): number[] => {
  const span = Math.max(hi - lo, 100_000);
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step / 2; v += step) out.push(v);
  return out;
};

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** The simulation's values, eased from the last answer to the new one. */
const useMorph = (values: readonly number[]): readonly number[] => {
  const [shown, setShown] = useState(values);
  const from = useRef(values);
  useEffect(() => {
    const start = from.current;
    if (start.length !== values.length || reducedMotion()) {
      from.current = values;
      setShown(values);
      return;
    }
    const t0 = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / MORPH_MS);
      const e = 1 - (1 - t) ** 3;
      const next = values.map((v, i) => (start[i] ?? v) + (v - (start[i] ?? v)) * e);
      from.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [values]);
  return shown;
};

const path = (xs: readonly number[], ys: readonly number[]) =>
  xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${(ys[i] ?? 0).toFixed(1)}`).join("");

/**
 * Balance from today to the sheet's last day: the sheet as it is (quiet) and the simulation
 * (accent, red where it goes below zero, on the termômetro's red wash). A dot marks the day the
 * answer names. A crosshair reads any day by pointer or by the arrow keys; the month table
 * carries every value without it.
 */
export const SimChart = ({
  days,
  label,
  same,
  mark,
}: {
  days: readonly ScenarioDay[];
  /** What the chart says, for screen readers. */
  label: string;
  /** The simulation is the sheet itself: one line, no legend. */
  same: boolean;
  /** The day the answer names: the first one below zero, or the lowest. */
  mark: ScenarioPoint | null;
}) => {
  const id = useId();
  // useId's colons are not welcome in a url(#…) reference.
  const clip = `clip${id.replace(/[^\w-]/g, "")}`;
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [at, setAt] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setWidth(Math.max(200, Math.round(el.getBoundingClientRect().width)));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const sim = useMorph(days.map((d) => d.sim));
  if (days.length < 2) return null;

  const values = [...days.map((d) => d.sheet), ...days.map((d) => d.sim), 0];
  const ticks = ticksFor(Math.min(...values), Math.max(...values));
  const lo = ticks[0] ?? 0;
  const hi = ticks.at(-1) ?? 1;
  const left = Math.ceil(Math.max(...ticks.map((t) => axisMoney(t).length)) * CHAR_PX) + 10;
  const plotW = width - left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const X = (i: number) => left + (i / (days.length - 1)) * plotW;
  const Y = (v: number) => PAD.top + ((hi - v) / (hi - lo || 1)) * plotH;
  const xs = days.map((_, i) => X(i));
  const today = days[0]?.date ?? "";
  const zero = Y(0);
  const bottom = HEIGHT - PAD.bottom;
  const markAt = mark ? days.findIndex((d) => d.date === mark.date) : -1;
  // A month name at each first day, every second or third month on a narrow screen.
  const firsts = days.flatMap((d, i) => (d.date.endsWith("-01") ? [i] : []));
  const every = Math.ceil(firsts.length / Math.max(2, Math.floor(plotW / 64)));
  const marks = firsts.filter((_, k) => k % every === 0);
  const hover = at === null ? null : days[at];

  const pick = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const i = Math.round(((clientX - r.left - left) / plotW) * (days.length - 1));
    setAt(Math.min(days.length - 1, Math.max(0, i)));
  };
  const key = (e: React.KeyboardEvent) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, PageDown: 30, PageUp: -30 }[e.key];
    // Esc first lets go of the crosshair; only a second one leaves the screen.
    if (e.key === "Escape") {
      if (at === null) return;
      e.preventDefault();
      return setAt(null);
    }
    if (e.key === "Home") return setAt(0);
    if (e.key === "End") return setAt(days.length - 1);
    if (step === undefined) return;
    e.preventDefault();
    setAt((a) => Math.min(days.length - 1, Math.max(0, (a ?? 0) + step)));
  };

  return (
    <figure className={same ? "sim-chart same" : "sim-chart"}>
      {!same && (
        <figcaption className="sim-legend">
          <span className="sheet">Planilha</span>
          <span className="sim">Simulação</span>
        </figcaption>
      )}
      {/* biome-ignore lint/a11y/useSemanticElements: a chart read by pointer and keys, not a form; the table says it all without it */}
      <div
        ref={box}
        className="sim-plot"
        role="group"
        aria-label={label}
        aria-describedby={`${id}-read`}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: arrow keys move the crosshair day by day
        tabIndex={0}
        onPointerMove={(e) => pick(e.clientX)}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerLeave={(e) => e.pointerType === "mouse" && setAt(null)}
        onKeyDown={key}
        onBlur={() => setAt(null)}
      >
        <svg width={width} height={HEIGHT} aria-hidden="true">
          <defs>
            <clipPath id={`${clip}-up`}>
              <rect x={0} y={0} width={width} height={Math.max(0, zero)} />
            </clipPath>
            <clipPath id={`${clip}-down`}>
              <rect x={0} y={zero} width={width} height={Math.max(0, HEIGHT - zero)} />
            </clipPath>
          </defs>
          {zero > PAD.top && zero < bottom && (
            <rect className="below" x={left} y={zero} width={plotW} height={bottom - zero} />
          )}
          {ticks.map((t) => (
            <g key={t} className={t === 0 ? "zero" : "grid"}>
              <line x1={left} x2={width - PAD.right} y1={Y(t)} y2={Y(t)} />
              <text className="amount" x={left - 8} y={Y(t) + 4}>
                {axisMoney(t)}
              </text>
            </g>
          ))}
          {marks.map((i, k) => {
            const d = days[i]?.date ?? "";
            // The year on the first month when the chart spans more than one, and where it turns.
            const spans = today.slice(0, 4) !== (days.at(-1)?.date ?? today).slice(0, 4);
            const was =
              k === 0
                ? spans
                  ? ""
                  : today.slice(0, 4)
                : (days[marks[k - 1] ?? 0]?.date ?? "").slice(0, 4);
            return (
              <text key={d} className="month" x={X(i)} y={HEIGHT - 8}>
                {monthName(Number(d.slice(5, 7))).slice(0, 3)}
                {d.slice(0, 4) === was ? "" : ` ${d.slice(2, 4)}`}
              </text>
            );
          })}
          {!same && (
            <path
              className="line sheet"
              d={path(
                xs,
                days.map((d) => Y(d.sheet)),
              )}
            />
          )}
          {(["up", "down"] as const).map((side) => (
            <path
              key={side}
              className={`${same ? "line sheet" : "line sim"}${side === "down" ? " below-zero" : ""}`}
              clipPath={`url(#${clip}-${side})`}
              d={path(
                xs,
                sim.map((v) => Y(v)),
              )}
            />
          ))}
          {markAt >= 0 && (
            <circle
              className={(sim[markAt] ?? 0) < 0 ? "mark neg" : "mark"}
              cx={X(markAt)}
              cy={Y(sim[markAt] ?? 0)}
              r={4.5}
            />
          )}
          {hover && at !== null && (
            <g className="cross">
              <line x1={X(at)} x2={X(at)} y1={PAD.top} y2={bottom} />
              {!same && <circle className="sheet" cx={X(at)} cy={Y(hover.sheet)} r={4} />}
              <circle className={same ? "sheet" : "sim"} cx={X(at)} cy={Y(hover.sim)} r={4} />
            </g>
          )}
        </svg>
        {hover && at !== null && (
          <div
            className="sim-tip"
            // Beside the crosshair, on the side with more room, so it never covers the dots.
            style={X(at) > width / 2 ? { right: width - X(at) + 12 } : { left: X(at) + 12 }}
          >
            <span className="date">{dayLabel(hover.date, today)}</span>
            <span className={same ? "sheet" : "sim"}>
              <b>{roundMoney(hover.sim)}</b>
              {same ? "" : " simulação"}
            </span>
            {!same && (
              <span className="sheet">
                <b>{roundMoney(hover.sheet)}</b> planilha
              </span>
            )}
          </div>
        )}
      </div>
      <p id={`${id}-read`} className="sr-only" aria-live="polite">
        {hover
          ? `${dayLabel(hover.date, today)}: simulação ${roundMoney(hover.sim)}${same ? "" : `, planilha ${roundMoney(hover.sheet)}`}`
          : "Setas para ler dia a dia."}
      </p>
    </figure>
  );
};
