import { useId, useLayoutEffect, useRef, useState } from "react";
import type { Mia2Grafico } from "../shared/types.ts";
import { money } from "./format.ts";
import { IconChevron } from "./icons.tsx";
import { valuesHidden } from "./privacy.ts";

const HEIGHT = 180;
const PAD = { top: 10, bottom: 24 } as const;
/** About one label character at 11px Geist. */
const CHAR_PX = 6.2;
/** A series name at the end of its line, cut to this many letters. */
const END_LABEL = 12;

/** About four round steps covering the values; bars always stand on zero. */
const ticksFor = (lo: number, hi: number): number[] => {
  const span = Math.max(hi - lo, 1);
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; ; v += step) {
    out.push(Number(v.toFixed(2)));
    if (v >= hi - 1e-9) break;
  }
  return out;
};

/** "12 mil" when the steps are thousands, "2.500" below that; never cents on an axis. */
const axisLabel = (reais: number, step: number) => {
  if (valuesHidden()) return reais === 0 ? "0" : "";
  if (reais === 0) return "0";
  const sign = reais < 0 ? "−" : "";
  const abs = Math.abs(reais);
  if (step >= 1000)
    return `${sign}${(abs / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return `${sign}${Math.round(abs).toLocaleString("pt-BR")}`;
};

const cents = (reais: number) => Math.round(reais * 100);
const short = (name: string) =>
  name.length > END_LABEL ? `${name.slice(0, END_LABEL - 1)}…` : name;

/** A bar with its data end rounded, standing on the baseline (or hanging from it below zero). */
const barPath = (x: number, w: number, base: number, end: number) => {
  const h = Math.abs(base - end);
  const r = Math.min(4, w / 2, h);
  if (end <= base) {
    return `M${x} ${base}V${end + r}Q${x} ${end} ${x + r} ${end}H${x + w - r}Q${x + w} ${end} ${x + w} ${end + r}V${base}Z`;
  }
  return `M${x} ${base}V${end - r}Q${x} ${end} ${x + r} ${end}H${x + w - r}Q${x + w} ${end} ${x + w} ${end - r}V${base}Z`;
};

/**
 * A chart Mia draws in the conversation: money over time (linha) or side by side (barras), up to
 * three series in a fixed order of color. Pointer or arrow keys read any point; the table under it
 * carries every value.
 */
export const MiaChart = ({ grafico }: { grafico: Mia2Grafico }) => {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  const [at, setAt] = useState<number | null>(null);
  const tip = useRef<HTMLDivElement>(null);
  const [tipW, setTipW] = useState(0);
  // The readout's own width, so it stays inside the chart on a small phone.
  // Measured while it floats: docked above the plot it takes the chart's whole width.
  useLayoutEffect(() => {
    if (at !== null && tip.current && !tip.current.classList.contains("docked"))
      setTipW(tip.current.offsetWidth);
  }, [at]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setWidth(Math.max(200, Math.round(el.getBoundingClientRect().width)));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { rotulos, series, tipo } = grafico;
  const n = rotulos.length;
  const values = series.flatMap((s) => s.valores);
  const bars = tipo === "barras";
  const lo0 = Math.min(...values);
  const hi0 = Math.max(...values);
  // Bars stand on zero; a line keeps zero in view only when it is near or crossed.
  const withZero = bars || lo0 < 0 || lo0 < hi0 * 0.3;
  const ticks = ticksFor(withZero ? Math.min(0, lo0) : lo0, withZero ? Math.max(0, hi0) : hi0);
  const lo = ticks[0] ?? 0;
  const hi = ticks.at(-1) ?? 1;
  const step = (ticks[1] ?? hi) - lo;
  const left = Math.ceil(Math.max(...ticks.map((t) => axisLabel(t, step).length)) * CHAR_PX) + 10;
  // Names at the ends of the lines, unless two would read the same once cut (the legend says it).
  const ends =
    !bars && series.length > 1 && new Set(series.map((s) => short(s.nome))).size === series.length;
  const right = ends
    ? Math.min(width * 0.3, Math.max(...series.map((s) => short(s.nome).length)) * CHAR_PX + 12)
    : 8;
  const plotW = width - left - right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const bottom = HEIGHT - PAD.bottom;
  const Y = (v: number) => PAD.top + ((hi - v) / (hi - lo || 1)) * plotH;
  const slot = plotW / n;
  // Bars sit in the middle of their slot; a line's points run edge to edge.
  const X = (i: number) =>
    bars ? left + slot * (i + 0.5) : left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  // As many labels as fit side by side, evenly skipped when they do not.
  const labelW = Math.max(...rotulos.map((r) => r.length)) * CHAR_PX + 12;
  const every = Math.ceil(n / Math.max(2, Math.floor(plotW / labelW)));
  // A line's first and last labels sit inside the plot, never past its edges.
  const anchor = (i: number) =>
    bars || n === 1 ? "label" : i === 0 ? "label first" : i === n - 1 ? "label last" : "label";
  const zero = Y(0);
  const groupW = Math.min(slot * 0.72, 18 * series.length + 2 * (series.length - 1));
  const barW = Math.max(2, (groupW - 2 * (series.length - 1)) / series.length);

  // Line end labels, nudged apart so two never sit on each other.
  const endYs = series.map((s) => Y(s.valores.at(-1) ?? 0));
  const order = endYs.map((y, i) => [y, i] as const).sort((a, b) => a[0] - b[0]);
  const placed = new Map<number, number>();
  let last = -Infinity;
  for (const [y, i] of order) {
    const yy = Math.max(y, last + 13);
    placed.set(i, yy);
    last = yy;
  }

  const pick = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const x = clientX - r.left - left;
    const i = bars ? Math.floor(x / slot) : Math.round((x / plotW) * (n - 1));
    setAt(Math.min(n - 1, Math.max(0, i)));
  };
  const key = (ev: React.KeyboardEvent) => {
    if (ev.key === "Escape") {
      if (at === null) return;
      ev.preventDefault();
      return setAt(null);
    }
    if (ev.key === "Home") return setAt(0);
    if (ev.key === "End") return setAt(n - 1);
    const move = { ArrowRight: 1, ArrowLeft: -1 }[ev.key];
    if (move === undefined) return;
    ev.preventDefault();
    setAt((a) => Math.min(n - 1, Math.max(0, (a ?? (move > 0 ? -1 : n)) + move)));
  };
  // On a narrow chart where neither side has room, the readout takes the head of the chart, over its
  // title, as stock apps do while a finger scrubs: the point it reads stays in view.
  const docked = (x: number) => tipW > 0 && x + 12 + tipW > width && x - 12 - tipW < 0;
  // Beside the point, on the side with room; where neither side has it, as close as fits.
  const tipLeft = (x: number) => {
    const side = x + 12 + tipW <= width ? x + 12 : x - 12 - tipW;
    return Math.max(0, Math.min(width - tipW, side));
  };
  const read = (i: number) =>
    `${rotulos[i]}: ${series.map((s) => `${series.length > 1 ? `${s.nome} ` : ""}${money(cents(s.valores[i] ?? 0))}`).join(", ")}`;

  return (
    <figure className={`mia-chart${bars ? " bars" : ""}${series.length === 1 ? " one" : ""}`}>
      <figcaption>
        <span className="mia-chart-title">{grafico.titulo}</span>
        {grafico.nota && <span className="mia-chart-note">{grafico.nota}</span>}
        {series.length > 1 && (
          <span className="mia-chart-legend">
            {series.map((s, k) => (
              <span key={s.nome} className={`s${k + 1}${bars ? " bar" : ""}`}>
                {s.nome}
              </span>
            ))}
          </span>
        )}
      </figcaption>
      {/* biome-ignore lint/a11y/useSemanticElements: a chart read by pointer and keys; the table below says it all without it */}
      <div
        ref={box}
        className="mia-chart-plot"
        role="group"
        aria-label={`${grafico.titulo}. Setas para ler ponto a ponto.`}
        aria-describedby={`${id}-read`}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: arrow keys move from point to point
        tabIndex={0}
        onPointerMove={(ev) => pick(ev.clientX)}
        onPointerDown={(ev) => pick(ev.clientX)}
        onPointerLeave={(ev) => ev.pointerType === "mouse" && setAt(null)}
        onKeyDown={key}
        onBlur={() => setAt(null)}
      >
        <svg width={width} height={HEIGHT} aria-hidden="true">
          {ticks.map((t) => (
            <g key={t} className={t === 0 ? "zero" : "grid"}>
              <line x1={left} x2={width - right} y1={Y(t)} y2={Y(t)} />
              <text className="amount" x={left - 8} y={Y(t) + 4}>
                {axisLabel(t, step)}
              </text>
            </g>
          ))}
          {rotulos.map((r, i) =>
            i % every === 0 ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: labels may repeat; one per point, in order
              <text key={`${r}-${i}`} className={anchor(i)} x={X(i)} y={HEIGHT - 6}>
                {r}
              </text>
            ) : null,
          )}
          {bars && at !== null && (
            <rect className="hover" x={left + slot * at} y={PAD.top} width={slot} height={plotH} />
          )}
          {bars
            ? series.map((s, k) => (
                <g key={s.nome} className={`s${k + 1}`}>
                  {s.valores.map((v, i) => {
                    const x = X(i) - groupW / 2 + k * (barW + 2);
                    const y = Y(v);
                    return (
                      <path
                        // biome-ignore lint/suspicious/noArrayIndexKey: one bar per label, in order
                        key={i}
                        className={v < 0 ? "bar neg" : "bar"}
                        d={barPath(
                          x,
                          barW,
                          zero,
                          Math.abs(y - zero) < 1 ? zero + (v < 0 ? 1 : -1) : y,
                        )}
                      />
                    );
                  })}
                </g>
              ))
            : series.map((s, k) => (
                <g key={s.nome} className={`s${k + 1}`}>
                  <path
                    className="line"
                    pathLength={1}
                    d={s.valores
                      .map((v, i) => `${i === 0 ? "M" : "L"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`)
                      .join("")}
                  />
                  {n <= 12 &&
                    s.valores.map((v, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: one point per label, in order
                      <circle key={i} className="dot" cx={X(i)} cy={Y(v)} r={4} />
                    ))}
                  {ends && (
                    <text className="end" x={width - right + 6} y={(placed.get(k) ?? 0) + 4}>
                      {short(s.nome)}
                    </text>
                  )}
                </g>
              ))}
          {!bars && at !== null && (
            <g className="cross">
              <line x1={X(at)} x2={X(at)} y1={PAD.top} y2={bottom} />
              {series.map((s, k) => (
                <circle
                  key={s.nome}
                  className={`s${k + 1}`}
                  cx={X(at)}
                  cy={Y(s.valores[at] ?? 0)}
                  r={4}
                />
              ))}
            </g>
          )}
        </svg>
        {at !== null && (
          <div
            aria-hidden="true"
            ref={tip}
            className={`mia-chart-tip${docked(X(at)) ? " docked" : ""}`}
            style={docked(X(at)) ? undefined : { left: tipLeft(X(at)) }}
          >
            <span className="date">{rotulos[at]}</span>
            {series.map((s, k) => (
              <span key={s.nome} className={series.length > 1 ? `s${k + 1}` : undefined}>
                <b>{money(cents(s.valores[at] ?? 0))}</b>
                {series.length > 1 ? ` ${s.nome}` : ""}
              </span>
            ))}
          </div>
        )}
      </div>
      <p id={`${id}-read`} className="sr-only" aria-live="polite">
        {at === null ? "" : read(at)}
      </p>
      <details className="formula mia-chart-table">
        <summary>
          <IconChevron />
          Ver em tabela
        </summary>
        <table>
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Ponto</span>
              </th>
              {series.map((s) => (
                <th key={s.nome} scope="col">
                  {s.nome}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rotulos.map((r, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: labels may repeat; one row per label, in order
              <tr key={`${r}-${i}`}>
                <th scope="row">{r}</th>
                {series.map((s) => (
                  <td key={s.nome}>{money(cents(s.valores[i] ?? 0))}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
};
