import { splitInstallment } from "@neko/engine";
import type { CSSProperties } from "react";
import { money } from "./format.ts";

const DIGITS = [..."0123456789"];

/**
 * The integer part as odometer wheels: each digit column scrolls to its new value when the
 * figure changes (and from zero when it first appears). Columns are keyed from the right, so
 * 999 → 1.000 adds a wheel instead of shuffling them. Separators and masked values stay still.
 */
const Rolling = ({ text }: { text: string }) => (
  <span className="int" aria-hidden="true">
    {[...text].map((ch, i, all) => {
      const place = all.length - i;
      return /\d/.test(ch) ? (
        <span key={`d${place}`} className="wheel">
          <span className="wheel-face">{ch}</span>
          <span className="wheel-strip" style={{ translate: `0 ${-Number(ch)}em` }}>
            {DIGITS.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </span>
        </span>
      ) : (
        <span key={`s${place}`}>{ch}</span>
      );
    })}
  </span>
);

/** `R$ 847,00` drawn as a figure: small currency, big integer, small cents. */
export const BigMoney = ({
  cents,
  tone,
}: {
  cents: number;
  tone?: "neg" | "plain" | undefined;
}) => {
  const text = money(cents);
  const m = /^(−?)R\$\s?([\d.]+|•+)(,\d{2})?$/.exec(text);
  return (
    <span className={`big-money${tone ? ` ${tone}` : ""}`}>
      <span className="sr-only">{text}</span>
      {m ? (
        <>
          <span className="cur" aria-hidden="true">
            {m[1]}R$
          </span>
          <Rolling text={m[2] ?? ""} />
          <span className="dec" aria-hidden="true">
            {m[3]}
          </span>
        </>
      ) : (
        <span aria-hidden="true">{text}</span>
      )}
    </span>
  );
};

const clamp = (n: number) => Math.min(1, Math.max(0, n));

/** Half-circle gauge: how much of the cycle budget is on the bill, with the pace tick on it. */
export const Gauge = ({
  value,
  total,
  mark,
  over,
  bad = false,
}: {
  value: number;
  total: number;
  mark: number;
  over: boolean;
  /** Past the plan, not just ahead of pace: the dot takes the figure's red. */
  bad?: boolean;
}) => {
  const share = total <= 0 ? 0 : clamp(value / total);
  const at = total <= 0 ? 0 : clamp(mark / total);
  const angle = Math.PI * (1 - at);
  const x = 100 + 88 * Math.cos(angle);
  const y = 100 - 88 * Math.sin(angle);
  return (
    <svg className="gauge" viewBox="0 0 200 108" aria-hidden="true">
      <path className="track" d="M 12 100 A 88 88 0 0 1 188 100" pathLength={100} />
      {share > 0 && (
        <path
          className="fill"
          d="M 12 100 A 88 88 0 0 1 188 100"
          pathLength={100}
          strokeDasharray={`${share * 100} 100`}
        />
      )}
      <circle className={`tick${bad ? " bad" : over ? " over" : ""}`} cx={x} cy={y} r={6} />
    </svg>
  );
};

export interface Column {
  key: string;
  label: string;
  value: number;
  /** Read by screen readers and shown when the column is picked. */
  description: string;
  tone?: "accent" | "faint" | undefined;
}

/**
 * Columns from a zero line, scaled to the largest absolute value. Display only: the values
 * come from the engine, this just turns them into heights.
 */
export const Columns = ({
  items,
  selected,
  onSelect,
  guide,
  label,
}: {
  items: readonly Column[];
  selected?: string;
  onSelect?: (key: string) => void;
  guide?: number | null;
  label: string;
}) => {
  const top = Math.max(0, ...items.map((i) => i.value), guide ?? 0);
  const bottom = Math.min(0, ...items.map((i) => i.value));
  const span = top - bottom || 1;
  const zero = (-bottom / span) * 100;
  return (
    <fieldset className="columns">
      <legend className="sr-only">{label}</legend>
      {guide != null && (
        <span
          className="guide"
          style={{ bottom: `calc(var(--label) + ${(guide - bottom) / span} * var(--plot))` }}
        />
      )}
      {items.map((i, n) => {
        const h = (Math.abs(i.value) / span) * 100;
        const style = {
          height: `${h}%`,
          bottom: `${i.value >= 0 ? zero : zero - h}%`,
          "--n": n,
        } as CSSProperties;
        const bar = (
          <>
            <span className="plot">
              <span
                className={`bar${i.tone ? ` ${i.tone}` : ""}${i.value < 0 ? " below" : ""}`}
                style={style}
              />
            </span>
            <span className="tick-label">{i.label}</span>
          </>
        );
        return onSelect ? (
          <button
            key={i.key}
            type="button"
            className="col"
            aria-pressed={i.key === selected}
            aria-label={i.description}
            onClick={() => onSelect(i.key)}
          >
            {bar}
          </button>
        ) : (
          <span
            key={i.key}
            className={`col${i.key === selected ? " picked" : ""}`}
            role="img"
            aria-label={i.description}
          >
            {bar}
          </span>
        );
      })}
    </fieldset>
  );
};

/** A line's name that truncates on its own, keeping an "n/N" installment count in view. */
export const ItemName = ({ text }: { text: string }) => {
  const { name, part } = splitInstallment(text);
  return (
    <span className="item-name">
      <span className="text">{name}</span>
      {part && <small className="part">{part}</small>}
    </span>
  );
};
