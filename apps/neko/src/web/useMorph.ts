import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * How long a new answer takes to move into place: long enough to follow the line, short enough
 * that a tap still feels instant (Material's medium durations run 250 to 400 ms).
 */
export const MORPH_MS = 360;

export const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** A CSS cubic-bezier as a function of time, solved by Newton's method as browsers do. */
const bezier = (x1: number, y1: number, x2: number, y2: number) => {
  const at = (t: number, p1: number, p2: number) =>
    ((1 - 3 * p2 + 3 * p1) * t * t + (3 * p2 - 6 * p1) * t + 3 * p1) * t;
  const slope = (t: number) =>
    3 * (1 - 3 * x2 + 3 * x1) * t * t + 2 * (3 * x2 - 6 * x1) * t + 3 * x1;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) t -= (at(t, x1, x2) - x) / slope(t);
    return at(Math.min(1, Math.max(0, t)), y1, y2);
  };
};

/** The app's settling curve (styles.css and Android's Motion.Settle): quick off, soft landing. */
export const settle = bezier(0.2, 0.7, 0.2, 1);

export interface Morph<T> {
  readonly from: T;
  readonly to: T;
  /** Eased progress from `from` to `to`, 0 to 1. */
  readonly e: number;
}

/**
 * A value moving from what is on screen to a new one, for the caller to mix by `e`. `sig` names
 * the value, so a new array holding the same numbers is no change, and once it has arrived nothing
 * runs. A change midway starts from where the drawing is; reduced motion jumps straight there.
 * With `initial`, the value arrives from it the first time it shows, as a figure counting up.
 */
export const useMorph = <T>(
  target: T,
  sig: string,
  mix: (from: T, to: T, e: number) => T,
  initial?: T,
): Morph<T> => {
  const [m, setM] = useState(() =>
    initial === undefined || reducedMotion()
      ? { sig, from: target, to: target, e: 1 }
      : { sig, from: initial, to: target, e: 0 },
  );
  let now = m;
  if (m.sig !== sig) {
    const still = reducedMotion();
    now = { sig, from: still ? target : mix(m.from, m.to, m.e), to: target, e: still ? 1 : 0 };
    setM(now);
  }
  const moving = now.e < 1;
  useEffect(() => {
    if (!moving) return;
    const t0 = performance.now();
    let frame = 0;
    const step = (time: number) => {
      const t = Math.min(1, (time - t0) / MORPH_MS);
      setM((s) => (s.sig === sig ? { ...s, e: settle(t) } : s));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [sig, moving]);
  return now;
};

/** Two numbers mixed: a figure counting to its new value. */
export const mixNumber = (a: number, b: number, e: number) => a + (b - a) * e;

/**
 * A block whose height follows its new words when `key` changes (another pace, the red), over
 * MORPH_MS, so the chips and the chart under it glide instead of jumping, as Android's
 * SizeTransform does. Typing (the same key) changes it in place.
 */
export const useGlide = <E extends HTMLElement>(key: string) => {
  const ref = useRef<E>(null);
  const was = useRef<{ key: string; height: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const running = el.getAnimations().filter((a) => a.id === "glide");
    // Another render of the same answer leaves a running glide alone instead of snapping it.
    if (running.length > 0 && was.current?.key === key) return;
    // Midway through a glide, the next one starts from where the block is drawn.
    const drawn = running.length > 0 ? el.getBoundingClientRect().height : was.current?.height;
    for (const a of running) a.cancel();
    const height = el.getBoundingClientRect().height;
    const before = was.current;
    was.current = { key, height };
    if (!before || before.key === key || drawn === undefined || reducedMotion()) return;
    if (Math.abs(drawn - height) < 1) return;
    el.style.overflow = "clip";
    const glide = el.animate([{ height: `${drawn}px` }, { height: `${height}px` }], {
      id: "glide",
      duration: MORPH_MS,
      easing: "cubic-bezier(0.2, 0.7, 0.2, 1)",
    });
    const done = () => {
      if (el.getAnimations().every((a) => a.id !== "glide" || a === glide)) el.style.overflow = "";
    };
    glide.addEventListener("finish", done);
    glide.addEventListener("cancel", done);
  });
  return ref;
};
