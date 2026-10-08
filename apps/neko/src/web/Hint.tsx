import { useEffect, useSyncExternalStore } from "react";

/**
 * One-time tips that teach the idea behind a number the first time it shows up, then leave for
 * good. At most one per visit, so the screen never turns into a manual; Ajustes › Como funciona
 * keeps every idea for later.
 */
const KEY = "neko.hintsSeen";

const read = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
};

let seen = read();
/** The tip this visit is spending its one slot on. */
let current: string | null = null;
const listeners = new Set<() => void>();
const notify = () => {
  for (const l of listeners) l();
};
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify([...seen]));
  } catch {
    // Private mode: the tip stays away until the page closes.
  }
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => `${current}|${seen.size}`;

export const dismissHint = (id: string) => {
  seen = new Set(seen).add(id);
  save();
  notify();
};

/** Ajustes › Rever dicas: every tip comes back, one per visit as before. */
export const resetHints = () => {
  seen = new Set();
  current = null;
  save();
  notify();
};

export const Hint = ({ id, children }: { id: string; children: string }) => {
  useSyncExternalStore(subscribe, snapshot);
  const show = !seen.has(id) && (current === null || current === id);
  useEffect(() => {
    if (show && current === null) {
      current = id;
      notify();
    }
  }, [show, id]);
  if (!show) return null;
  return (
    <aside className="tip" aria-label="Dica">
      <span className="tip-mark" aria-hidden="true">
        i
      </span>
      <p className="tip-text">{children}</p>
      <button type="button" className="ghost small tip-ok" onClick={() => dismissHint(id)}>
        Entendi
      </button>
    </aside>
  );
};
