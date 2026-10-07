import { useSyncExternalStore } from "react";

/** Per-device "hide values" switch, for showing the screen to someone else. */
const KEY = "neko.hideValues";

const read = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

let hidden = read();
const listeners = new Set<() => void>();

export const valuesHidden = () => hidden;

export const toggleValues = () => {
  hidden = !hidden;
  try {
    localStorage.setItem(KEY, hidden ? "1" : "0");
  } catch {
    // Private mode: the switch still works until the page closes.
  }
  for (const l of listeners) l();
};

export const useValuesHidden = () =>
  useSyncExternalStore((l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  }, valuesHidden);
