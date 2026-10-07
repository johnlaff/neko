import { addDays, clampedDay, diffDays, type LocalDate, parts } from "./date.ts";
import type { Ledger, NoteItem } from "./ledger.ts";
import { add, type Cents, ZERO } from "./money.ts";

export interface CardConfig {
  /** Name as written in the notes (`R$ 0,00 - Itau`). Matching ignores case and accents. */
  readonly name: string;
  readonly dueDay: number;
  readonly closingDay: number;
  /** True when the closing day was guessed (due day − 7) instead of configured. */
  readonly closingEstimated: boolean;
}

export interface Cycle {
  /** Previous closing day: purchases after it land on this bill. */
  readonly start: LocalDate;
  /** Closing day: purchases up to and including it land on this bill. */
  readonly closing: LocalDate;
  readonly due: LocalDate;
}

const CARD_SECTIONS = new Set(["cartao", "cartoes", "fatura", "faturas"]);

/** Card identity from a note description: drops `#tags` and a `(...)` suffix, folds case/accents. */
export const normalizeName = (s: string): string =>
  (s.split("#")[0] ?? "")
    .replace(/\([^)]*\)\s*$/, "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const displayName = (s: string) => (s.split("#")[0] ?? "").replace(/\([^)]*\)\s*$/, "").trim();

export const isCardItem = (item: NoteItem): boolean =>
  item.section !== null && CARD_SECTIONS.has(item.section);

/** The bill due in (year, month) for this card, with its closing and cycle start. */
export const cycleForDueMonth = (card: CardConfig, year: number, month: number): Cycle => {
  const due = clampedDay(year, month, card.dueDay);
  const closingMonth = card.closingDay < card.dueDay ? month : month - 1;
  const closing = clampedDay(year, closingMonth, card.closingDay);
  const prevClosingMonth = closingMonth - 1;
  const prevClosing = clampedDay(year, prevClosingMonth, card.closingDay);
  return { start: prevClosing, closing, due };
};

/** The bill a purchase made on `date` falls into. */
export const cycleContaining = (card: CardConfig, date: LocalDate): Cycle => {
  const { year, month } = parts(date);
  for (let offset = -1; offset <= 2; offset++) {
    const c = cycleForDueMonth(card, year, month + offset);
    if (diffDays(c.start, date) > 0 && diffDays(date, c.closing) >= 0) return c;
  }
  throw new Error(`no cycle found for ${card.name} on ${date}`);
};

/** Amount the sheet already holds for this card on a given due date (Saída note lines). */
export const billOnSheet = (ledger: Ledger, card: CardConfig, due: LocalDate): Cents | null => {
  const row = ledger.find((r) => r.date === due);
  if (!row) return null;
  const key = normalizeName(card.name);
  const lines = row.saida.items.filter(
    (i) => isCardItem(i) && normalizeName(i.description) === key,
  );
  return lines.length === 0 ? ZERO : add(...lines.map((i) => i.amount));
};

/**
 * Cards found in the notes, with the due day they appear on most often. The closing day is a
 * guess (7 days before due) until configured.
 */
export const inferCards = (ledger: Ledger): CardConfig[] => {
  const seen = new Map<string, { name: string; days: Map<number, number> }>();
  for (const row of ledger) {
    for (const item of row.saida.items) {
      if (!isCardItem(item)) continue;
      const key = normalizeName(item.description);
      const entry = seen.get(key) ?? { name: displayName(item.description), days: new Map() };
      const day = parts(row.date).day;
      entry.days.set(day, (entry.days.get(day) ?? 0) + 1);
      seen.set(key, entry);
    }
  }
  return [...seen.values()]
    .map(({ name, days }) => {
      const dueDay = [...days.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 1;
      const closingDay = parts(addDays(clampedDay(2026, 1, dueDay), -7)).day;
      return { name, dueDay, closingDay, closingEstimated: true };
    })
    .sort((a, b) => a.dueDay - b.dueDay || a.name.localeCompare(b.name));
};

/** Configured cards override inferred ones with the same name; unmatched inferred ones stay. */
export const mergeCards = (
  inferred: readonly CardConfig[],
  configured: readonly Omit<CardConfig, "closingEstimated">[],
): CardConfig[] => {
  const byKey = new Map(inferred.map((c) => [normalizeName(c.name), c]));
  for (const c of configured) byKey.set(normalizeName(c.name), { ...c, closingEstimated: false });
  return [...byKey.values()].sort((a, b) => a.dueDay - b.dueDay || a.name.localeCompare(b.name));
};
