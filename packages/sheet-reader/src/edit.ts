import { type Cents, cents, fromReais, normalizeName, type Placement } from "@neko/engine";
import type { ApiCell } from "./grid.ts";
import { normalizeSection, parseNote } from "./note.ts";

/**
 * Plans the change one entry makes to one Entrada/Saída/Diário cell, exactly as the owner would
 * type it (specs/005-lancamentos): one more `+valor` in the `=SUM(...)` and one more
 * `R$ valor - descrição` line in the note, or a bigger card line on the bill. Pure: it only
 * returns the new formula and note, and refuses any cell it does not fully understand, so the
 * write can never turn a cell into something the owner did not mean.
 */

export interface CellContents {
  /** Amount of the cell, in cents. */
  readonly total: Cents;
  /** The `=SUM` terms, or the single number, in cents and in order. Zero cells have none. */
  readonly terms: readonly Cents[];
}

export type CellCheck = ({ ok: true } & CellContents) | { ok: false; reason: string };

export type EditPlan =
  | {
      ok: true;
      /** New `userEnteredValue`, a formula in the sheet's own dialect; "" empties the cell. */
      formula: string;
      note: string;
      before: Cents;
      after: Cents;
    }
  | { ok: false; reason: string };

export type EditOp = Pick<Placement, "section" | "amount" | "description" | "target" | "was">;

const SUM = /^=SUM\(([\s\d,+]*)\)$/;
const TERM = /^\d+(,\d{1,2})?$/;

const termCents = (t: string): Cents | null => {
  if (!TERM.test(t)) return null;
  const [int, dec = ""] = t.split(",");
  return cents(Number(int) * 100 + Number(dec.padEnd(2, "0")));
};

/** `4240` → `42,4`, `2000` → `20`: how the owner writes numbers inside `=SUM(...)`. */
export const formulaTerm = (c: Cents): string => {
  const int = Math.trunc(c / 100);
  const dec = String(c % 100)
    .padStart(2, "0")
    .replace(/0+$/, "");
  return dec === "" ? String(int) : `${int},${dec}`;
};

/** `125240` → `R$ 1.252,40`: how the owner writes amounts in notes. */
export const noteAmount = (c: Cents): string => {
  const int = String(Math.trunc(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `R$ ${int},${String(c % 100).padStart(2, "0")}`;
};

const sameMultiset = (a: readonly number[], b: readonly number[]) => {
  const x = [...a].sort((p, q) => p - q);
  const y = [...b].sort((p, q) => p - q);
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

const formulaTerms = (formula: string): Cents[] | null => {
  const m = SUM.exec(formula);
  if (!m) return null;
  const out: Cents[] = [];
  for (const raw of (m[1] ?? "").split("+")) {
    const t = raw.trim();
    if (t === "") continue;
    const c = termCents(t);
    if (c === null) return null;
    out.push(c);
  }
  return out;
};

/**
 * A cell the writer may touch: empty, or a number or `=SUM` of plain numbers whose terms are
 * exactly the non-zero lines of its note, with no line the note grammar cannot read.
 */
export const checkCell = (cell: ApiCell | undefined): CellCheck => {
  const entered = cell?.userEnteredValue ?? {};
  if (entered.stringValue !== undefined) return { ok: false, reason: "a célula tem texto" };
  let terms: Cents[];
  if (entered.formulaValue !== undefined) {
    const parsed = formulaTerms(entered.formulaValue);
    if (parsed === null) return { ok: false, reason: "a fórmula não é uma soma simples" };
    terms = parsed;
  } else if (entered.numberValue !== undefined) {
    const c = fromReais(entered.numberValue);
    if (c < 0) return { ok: false, reason: "a célula tem valor negativo" };
    terms = c === 0 ? [] : [c];
  } else terms = [];

  const total = cents(terms.reduce((a, b) => a + b, 0));
  const shown = cell?.effectiveValue?.numberValue;
  if (terms.length > 0 && (shown === undefined || fromReais(shown) !== total))
    return { ok: false, reason: "o valor mostrado não é a soma da fórmula" };

  const note = parseNote(cell?.note);
  if (note.unparsed.length > 0) return { ok: false, reason: "a nota tem linhas que não entendo" };
  const lines = note.items.map((i) => i.amount).filter((a) => a !== 0);
  if (terms.length > 0 && note.items.length === 0)
    return { ok: false, reason: "a célula tem valor e não tem nota" };
  if (!sameMultiset(lines, terms))
    return { ok: false, reason: "a nota e a fórmula não têm os mesmos valores" };
  return { ok: true, total, terms };
};

const HEADERS: Record<string, { readonly names: readonly string[]; readonly label: string }> = {
  contas: { names: ["conta", "contas"], label: "CONTAS" },
  cartoes: { names: ["cartao", "cartoes", "fatura", "faturas"], label: "CARTÕES" },
  investimento: { names: ["investimento", "investimentos"], label: "Investimento:" },
  reserva: { names: ["reserva"], label: "Reserva:" },
};

const isItemLine = (line: string) => /^r\$/i.test(line.trim());
const isHeaderLine = (line: string) => line.trim() !== "" && !isItemLine(line);

/** Where a new line goes: after the last line of its section, or at the top for no section. */
const insertLine = (note: string, section: string | null, line: string): string => {
  const lines = note === "" ? [] : note.split("\n");
  const lastNonBlank = (from: number, to: number) => {
    for (let i = to - 1; i >= from; i--) if ((lines[i] ?? "").trim() !== "") return i;
    return -1;
  };
  if (section === null) {
    const firstHeader = lines.findIndex(isHeaderLine);
    if (firstHeader === -1) {
      const last = lastNonBlank(0, lines.length);
      lines.splice(last + 1, 0, line);
      return lines.join("\n");
    }
    const last = lastNonBlank(0, firstHeader);
    // Lines above the first header have no section; keep a blank line before that header.
    if (last === -1) lines.splice(0, 0, line, "");
    else lines.splice(last + 1, 0, line);
    return lines.join("\n");
  }
  const spec = HEADERS[section];
  if (!spec) throw new Error(`unknown section ${section}`);
  const headerAt = lines.findLastIndex(
    (l) => isHeaderLine(l) && spec.names.includes(normalizeSection(l)),
  );
  if (headerAt === -1) {
    const last = lastNonBlank(0, lines.length);
    const head = lines.slice(0, last + 1);
    return [
      ...head,
      ...(head.length > 0 ? [""] : []),
      spec.label,
      line,
      ...lines.slice(last + 1),
    ].join("\n");
  }
  let end = lines.length;
  for (let i = headerAt + 1; i < lines.length; i++)
    if (isHeaderLine(lines[i] ?? "")) {
      end = i;
      break;
    }
  const lastItem = lastNonBlank(headerAt + 1, end);
  lines.splice(lastItem === -1 ? headerAt + 1 : lastItem + 1, 0, line);
  return lines.join("\n");
};

/** Adds `+term` after the last term, keeping the owner's spacing and line breaks. */
const appendTerm = (formula: string | undefined, terms: readonly Cents[], add: Cents): string => {
  if (formula === undefined) return `=SUM(${[...terms, add].map(formulaTerm).join("+")})`;
  const inner = SUM.exec(formula)?.[1] ?? "";
  const cut = inner.search(/\s*$/);
  const head = inner.slice(0, cut);
  const sep = /\d/.test(head) ? "+" : "";
  return `=SUM(${head}${sep}${formulaTerm(add)}${inner.slice(cut)})`;
};

/**
 * Changes the last `+`-separated term worth `from` to `to`, spacing untouched; `to` 0 drops the
 * term, and the cell's `formula` becomes "" (empty) when none is left.
 */
const replaceTerm = (formula: string | undefined, from: Cents, to: Cents): string | null => {
  if (formula === undefined) {
    if (from <= 0) return null;
    return to === 0 ? "" : `=SUM(${formulaTerm(to)})`;
  }
  const inner = SUM.exec(formula)?.[1] ?? "";
  const cut = inner.search(/\s*$/);
  const parts = inner.slice(0, cut).split("+");
  for (let i = parts.length - 1; i >= 0; i--) {
    const raw = parts[i] ?? "";
    if (termCents(raw.trim()) !== from) continue;
    if (to === 0) parts.splice(i, 1);
    else parts[i] = raw.replace(raw.trim(), formulaTerm(to));
    const head = parts.join("+");
    return /\d/.test(head) ? `=SUM(${head}${inner.slice(cut)})` : "";
  }
  return null;
};

/** The `R$` lines of a note with their index and the section they sit in, as the parser sees them. */
const itemLines = (lines: readonly string[]) => {
  let section: string | null = null;
  const out: { at: number; section: string | null; amount: Cents; description: string }[] = [];
  for (const [at, l] of lines.entries()) {
    if (isHeaderLine(l)) section = normalizeSection(l.trim());
    if (!isItemLine(l)) continue;
    const item = parseNote(l).items[0];
    if (item) out.push({ at, section, amount: item.amount, description: item.description });
  }
  return out;
};

/** The same line with a new amount: the owner's spacing and description stay. */
const withAmount = (raw: string, amount: Cents): string => {
  const dash = raw.indexOf("-", raw.toLowerCase().indexOf("r$") + 2);
  return `${raw.slice(0, raw.search(/\S/))}${noteAmount(amount)} ${raw.slice(dash)}`;
};

/** Drops line `at`, and its header with the blank lines before it once the section is empty. */
const dropLine = (lines: string[], at: number): string => {
  lines.splice(at, 1);
  let header = -1;
  for (let i = at - 1; i >= 0; i--)
    if (isHeaderLine(lines[i] ?? "")) {
      header = i;
      break;
    }
  if (header !== -1) {
    let end = lines.length;
    for (let i = header + 1; i < lines.length; i++)
      if (isHeaderLine(lines[i] ?? "")) {
        end = i;
        break;
      }
    if (!lines.slice(header + 1, end).some(isItemLine)) {
      let from = header;
      while (from > 0 && (lines[from - 1] ?? "").trim() === "") from--;
      // Keep the blank line that separated what came before from the next header.
      const next = end < lines.length && from > 0 ? 1 : 0;
      lines.splice(from + next, end - from - next);
    }
  }
  return lines.every((l) => l.trim() === "") ? "" : lines.join("\n");
};

export const planCellEdit = (cell: ApiCell | undefined, op: EditOp): EditPlan => {
  const check = checkCell(cell);
  if (!check.ok) return check;
  const changing = op.was !== undefined;
  if (
    !Number.isSafeInteger(op.amount) ||
    op.amount < 0 ||
    (!changing && op.amount === 0) ||
    (changing && (!Number.isSafeInteger(op.was) || (op.was ?? 0) < 0 || op.was === op.amount))
  )
    return { ok: false, reason: "o valor precisa ser maior que zero" };
  const description = op.description.replace(/\s+/g, " ").trim();
  if (description === "" || /^r\$/i.test(description))
    return { ok: false, reason: "a descrição é inválida" };

  const formula = cell?.userEnteredValue?.formulaValue;
  const note = cell?.note ?? "";
  const before = check.total;
  const lines = note === "" ? [] : note.split("\n");
  const key = normalizeName(description);
  let after: Cents;
  let next: { formula: string | null; note: string };

  if (op.target === "card") {
    const matches = itemLines(lines).filter(
      (i) =>
        i.section !== null &&
        HEADERS.cartoes?.names.includes(i.section) &&
        normalizeName(i.description) === key,
    );
    if (matches.length > 1)
      return { ok: false, reason: `a fatura tem mais de uma linha ${description}` };
    const old = matches[0];
    const current = old?.amount ?? cents(0);
    if (changing && op.was !== current)
      return { ok: false, reason: `a fatura do ${description} mudou; confira de novo` };
    const total = changing ? op.amount : cents(current + op.amount);
    after = cents(before - current + total);
    if (old) {
      lines[old.at] = withAmount(lines[old.at] ?? "", total);
      next = {
        formula:
          current === 0
            ? appendTerm(formula, check.terms, total)
            : replaceTerm(formula, current, total),
        note: lines.join("\n"),
      };
    } else
      next = {
        formula: appendTerm(formula, check.terms, total),
        note: insertLine(note, "cartoes", `${noteAmount(total)} - ${description}`),
      };
  } else if (changing) {
    const was = op.was ?? cents(0);
    const old = itemLines(lines)
      .filter(
        (i) => i.section === op.section && i.amount === was && normalizeName(i.description) === key,
      )
      .at(-1);
    if (!old) return { ok: false, reason: `a linha ${description} não está mais lá` };
    after = cents(before - was + op.amount);
    const newFormula =
      was === 0
        ? appendTerm(formula, check.terms, op.amount)
        : replaceTerm(formula, was, op.amount);
    if (op.amount === 0) next = { formula: newFormula, note: dropLine(lines, old.at) };
    else {
      lines[old.at] = withAmount(lines[old.at] ?? "", op.amount);
      next = { formula: newFormula, note: lines.join("\n") };
    }
  } else {
    after = cents(before + op.amount);
    next = {
      formula: appendTerm(formula, check.terms, op.amount),
      note: insertLine(note, op.section, `${noteAmount(op.amount)} - ${description}`),
    };
  }
  if (next.formula === null) return { ok: false, reason: "não achei o valor na fórmula" };

  // Read our own output back with the same rules: it must be a clean cell worth `after`.
  const reread = checkCell(
    next.formula === ""
      ? { note: next.note }
      : {
          userEnteredValue: { formulaValue: next.formula },
          effectiveValue: { numberValue: after / 100 },
          note: next.note,
        },
  );
  if (!reread.ok || reread.total !== after)
    throw new Error(`planCellEdit produced an inconsistent cell: ${JSON.stringify(next)}`);
  return { ok: true, formula: next.formula, note: next.note, before, after };
};
