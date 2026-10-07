import { type Cents, cents, type NoteItem } from "@neko/engine";
import { parseNumber } from "./number.ts";

export interface ParsedNote {
  readonly items: NoteItem[];
  readonly unparsed: string[];
}

/** `CARTÕES:` → `cartoes`. */
export const normalizeSection = (line: string): string =>
  line
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/:\s*$/, "")
    .trim();

/**
 * Note grammar: `R$ <valor> - <descrição>` lines, grouped under header lines (any line not
 * starting with `R$`, e.g. `CARTÕES:`). The value ends at the first `-` after `R$`, so dashes
 * inside the description survive. Zero lines are kept: `R$ 0,00 - Itau` marks an empty bill.
 */
export const parseNote = (note: string | undefined): ParsedNote => {
  const items: NoteItem[] = [];
  const unparsed: string[] = [];
  if (!note) return { items, unparsed };
  let section: string | null = null;
  for (const raw of note.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    if (!/^r\$/i.test(line)) {
      section = normalizeSection(line);
      continue;
    }
    const rest = line.slice(2);
    const dashAt = rest.indexOf("-");
    const valueText = dashAt >= 0 ? rest.slice(0, dashAt) : rest;
    const description = dashAt >= 0 ? rest.slice(dashAt + 1).trim() : "";
    const amount = parseNumber(valueText);
    if (amount === null || amount < 0) {
      unparsed.push(line);
      continue;
    }
    items.push({ amount, description, section });
  }
  return { items, unparsed };
};

export interface CeilingNote {
  readonly perDay: Cents;
  readonly total: Cents;
  readonly days: number;
}

/**
 * The "previsão do diário" note: `R$ <total> / <N> Dias = R$ <por dia>`, optionally with
 * `Mensal R$ <v> <nome>` items and a `Total = R$ <v>` line. Returns null unless it is consistent.
 */
export const parseCeilingNote = (note: string | undefined): CeilingNote | null => {
  if (!note) return null;
  const lines = note.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim());
  const divisors = lines
    .map((l) => /^R\$ ?([\d.,]+) ?\/ ?(\d+) ?dias? ?= ?R\$ ?([\d.,]+)$/i.exec(l))
    .filter((m) => m !== null);
  if (divisors.length !== 1) return null;
  const [, totalText, daysText, perDayText] = divisors[0] as RegExpExecArray;
  const total = parseNumber(totalText ?? "");
  const perDay = parseNumber(perDayText ?? "");
  const days = Number(daysText);
  if (total === null || perDay === null || total <= 0 || days <= 0) return null;
  const totals = lines.map((l) => /^Total ?= ?R\$ ?([\d.,]+)$/i.exec(l)).filter((m) => m !== null);
  if (totals.length > 1) return null;
  if (totals.length === 1 && parseNumber(totals[0]?.[1] ?? "") !== total) return null;
  const items = lines
    .map((l) => /^(?:Mensal )?R\$ ?([\d.,]+) (?!\/)\S.*$/i.exec(l))
    .filter((m) => m !== null)
    .map((m): number => parseNumber(m[1] ?? "") ?? 0);
  if (items.length > 0 && items.reduce((a: number, b) => a + b, 0) !== total) return null;
  if (perDay !== Math.floor(total / days) && perDay !== Math.ceil(total / days)) return null;
  return { perDay: cents(perDay), total, days };
};
