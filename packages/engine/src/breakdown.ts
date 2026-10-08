import { isCardItem, normalizeName } from "./cards.ts";
import { parts } from "./date.ts";
import type { Ledger, NoteItem } from "./ledger.ts";
import { add, type Cents, mul, sub, ZERO } from "./money.ts";

/** One line of "where the month's money went": a description and everything spent under it. */
export interface Outflow {
  readonly label: string;
  readonly amount: Cents;
  readonly count: number;
  readonly kind: "card" | "bill";
  /** Amount minus the same description's total the month before; null when it did not appear then. */
  readonly change: Cents | null;
  /** How many lines it had the month before; null when it did not appear then. */
  readonly countBefore: number | null;
  /** A card bill of someone else's card (Ajustes › Outra pessoa): money that comes back. */
  readonly others: boolean;
}

const INSTALLMENT = /^(.*?)\s*(\d{1,3})\s*\/\s*(\d{1,3})$/;
const INSTALLMENT_SUFFIX = /\s*\d{1,3}\s*\/\s*\d{1,3}$/;

/** "Financiamento Carro 13/36" → name and "13/36", so screens can keep the count visible. */
export const splitInstallment = (description: string) => {
  const m = INSTALLMENT.exec(description.trim());
  return m?.[1] ? { name: m[1], part: `${m[2]}/${m[3]}` } : { name: description, part: null };
};

/** A card bill line: under a card section, or named like a known card. */
const cardTest = (cardNames: readonly string[]) => {
  const names = new Set(cardNames.map(normalizeName));
  return (item: NoteItem, label: string) => isCardItem(item) || names.has(normalizeName(label));
};

/** Label for Saída amounts the note does not itemize. */
export const UNITEMIZED = "Sem detalhe";

/** What makes two lines the same destination: "Carro 12/36" and "carro 13/36" are one. */
export const outflowKey = (label: string) =>
  normalizeName(label.replace(INSTALLMENT_SUFFIX, "")) || UNITEMIZED;

type Group = { label: string; amount: Cents; count: number; card: boolean };

/** One month's Saída by description key; what the note does not itemize goes to UNITEMIZED. */
const groupMonth = (
  ledger: Ledger,
  year: number,
  month: number,
  isCard: (item: NoteItem, label: string) => boolean,
) => {
  const groups = new Map<string, Group>();
  const put = (key: string, label: string, amount: Cents, card: boolean) => {
    const g = groups.get(key);
    if (g) groups.set(key, { ...g, amount: add(g.amount, amount), count: g.count + 1 });
    else groups.set(key, { label, amount, count: 1, card });
  };
  for (const row of ledger) {
    const p = parts(row.date);
    if (p.year !== year || p.month !== month) continue;
    let itemized = ZERO;
    for (const item of row.saida.items) {
      if (item.amount <= 0) continue;
      itemized = add(itemized, item.amount);
      const label = item.description.split("#")[0]?.trim() || UNITEMIZED;
      // "Carro 12/36" and "Carro 13/36" are the same destination a month apart.
      const key = outflowKey(label);
      put(key, label, item.amount, isCard(item, label));
    }
    const rest = sub(row.saida.amount, itemized);
    if (rest > 0) put(UNITEMIZED, UNITEMIZED, rest, false);
  }
  return groups;
};

/**
 * The month's Saída grouped by description (case, accents and `#tags` ignored), largest first,
 * each with what the same description cost the month before. The part of a cell its note does
 * not explain becomes "Sem detalhe", so the lines always add up to the month's Saída total.
 */
export const monthOutflows = (
  ledger: Ledger,
  year: number,
  month: number,
  cardNames: readonly string[] = [],
  othersCards: readonly string[] = [],
): Outflow[] => {
  const isCard = cardTest(cardNames);
  const others = new Set(othersCards.map(normalizeName));
  const last = shiftMonth(year, month, -1);
  const previous = groupMonth(ledger, last.year, last.month, isCard);
  return [...groupMonth(ledger, year, month, isCard)]
    .map(([key, g]) => {
      const before = previous.get(key);
      return {
        label: g.label,
        amount: g.amount,
        count: g.count,
        kind: g.card ? ("card" as const) : ("bill" as const),
        change: before ? sub(g.amount, before.amount) : null,
        countBefore: before ? before.count : null,
        others: g.card && others.has(normalizeName(g.label)),
      };
    })
    .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label, "pt-BR"));
};

/** A Saída line that comes back every month: a recurring bill or an `n/N` installment. */
export interface Fixed {
  readonly label: string;
  readonly amount: Cents;
  readonly installment: {
    readonly paid: number;
    readonly total: number;
    /** Month of the last installment. */
    readonly ends: { readonly year: number; readonly month: number };
    /** What the installments after this month still cost. */
    readonly left: Cents;
  } | null;
}

const capitalized = (s: string) => s.charAt(0).toLocaleUpperCase("pt-BR") + s.slice(1);

const shiftMonth = (year: number, month: number, by: number) => {
  const i = year * 12 + (month - 1) + by;
  return { year: Math.floor(i / 12), month: (i % 12) + 1 };
};

/** Non-card saída lines of one month by identity, installment suffix stripped. */
const monthLines = (
  ledger: Ledger,
  year: number,
  month: number,
  isCard: (item: NoteItem, label: string) => boolean,
) => {
  const lines = new Map<
    string,
    { label: string; amount: Cents; paid: number | null; total: number | null }
  >();
  for (const row of ledger) {
    const p = parts(row.date);
    if (p.year !== year || p.month !== month) continue;
    for (const item of row.saida.items) {
      const raw = item.description.split("#")[0]?.trim() ?? "";
      if (item.amount <= 0 || isCard(item, raw)) continue;
      const m = INSTALLMENT.exec(raw);
      const paid = m ? Number(m[2]) : null;
      const total = m ? Number(m[3]) : null;
      const isInstallment =
        paid !== null && total !== null && total >= 2 && paid >= 1 && paid <= total;
      const label = capitalized(isInstallment && m ? (m[1] ?? "").trim() : raw);
      const key = normalizeName(label);
      if (!key) continue;
      const prev = lines.get(key);
      lines.set(key, {
        label: prev?.label ?? label,
        amount: add(prev?.amount ?? ZERO, item.amount),
        paid: isInstallment ? paid : (prev?.paid ?? null),
        total: isInstallment ? total : (prev?.total ?? null),
      });
    }
  }
  return lines;
};

/**
 * What the month commits to beyond day-to-day spending: every `n/N` installment line, plus
 * non-card bills that also showed up in at least two of the three months before. Cards are
 * left out (their bills vary with spending). Largest first.
 */
export const monthFixed = (
  ledger: Ledger,
  year: number,
  month: number,
  cardNames: readonly string[] = [],
): Fixed[] => {
  const isCard = cardTest(cardNames);
  const now = monthLines(ledger, year, month, isCard);
  const before = [1, 2, 3].map((k) => {
    const at = shiftMonth(year, month, -k);
    return monthLines(ledger, at.year, at.month, isCard);
  });
  const fixed: Fixed[] = [];
  for (const [key, line] of now) {
    if (line.paid !== null && line.total !== null) {
      const remaining = line.total - line.paid;
      fixed.push({
        label: line.label,
        amount: line.amount,
        installment: {
          paid: line.paid,
          total: line.total,
          ends: shiftMonth(year, month, remaining),
          left: mul(line.amount, remaining),
        },
      });
    } else if (before.filter((b) => b.has(key)).length >= 2) {
      fixed.push({ label: line.label, amount: line.amount, installment: null });
    }
  }
  return fixed.sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label, "pt-BR"));
};

/**
 * The fixed line behind one of the month's destinations, matched the way the two group lines
 * ("Aluguel" and "aluguel ", "Carro 13/36" and "Carro"). Card bills are never fixed.
 */
export const fixedOf = (o: Outflow, fixed: readonly Fixed[]): Fixed | null => {
  if (o.kind === "card") return null;
  const key = outflowKey(o.label);
  return fixed.find((f) => outflowKey(f.label) === key) ?? null;
};
