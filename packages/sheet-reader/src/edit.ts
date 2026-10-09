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
      /** New `userEnteredValue`, always a formula in the sheet's own dialect. */
      formula: string;
      note: string;
      before: Cents;
      after: Cents;
    }
  | { ok: false; reason: string };

export type EditOp = Pick<Placement, "section" | "amount" | "description" | "target">;

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

/** Replaces the last `+`-separated term worth `from` with `to`, spacing untouched. */
const replaceTerm = (formula: string | undefined, from: Cents, to: Cents): string | null => {
  if (formula === undefined) return from > 0 ? `=SUM(${formulaTerm(to)})` : null;
  const inner = SUM.exec(formula)?.[1] ?? "";
  const parts = inner.split("+");
  for (let i = parts.length - 1; i >= 0; i--) {
    const raw = parts[i] ?? "";
    if (termCents(raw.trim()) === from) {
      parts[i] = raw.replace(raw.trim(), formulaTerm(to));
      return `=SUM(${parts.join("+")})`;
    }
  }
  return null;
};

export const planCellEdit = (cell: ApiCell | undefined, op: EditOp): EditPlan => {
  const check = checkCell(cell);
  if (!check.ok) return check;
  if (!Number.isSafeInteger(op.amount) || op.amount <= 0)
    return { ok: false, reason: "o valor precisa ser maior que zero" };
  const description = op.description.replace(/\s+/g, " ").trim();
  if (description === "" || /^r\$/i.test(description))
    return { ok: false, reason: "a descrição é inválida" };

  const formula = cell?.userEnteredValue?.formulaValue;
  const note = cell?.note ?? "";
  const before = check.total;
  const after = cents(before + op.amount);
  let next: { formula: string; note: string } | null = null;

  if (op.target === "card") {
    const key = normalizeName(description);
    const parsed = parseNote(note);
    const matches = parsed.items.filter(
      (i) =>
        i.section !== null &&
        HEADERS.cartoes?.names.includes(i.section) &&
        normalizeName(i.description) === key,
    );
    if (matches.length > 1)
      return { ok: false, reason: `a fatura tem mais de uma linha ${description}` };
    const old = matches[0];
    if (old) {
      // Walk the lines as the parser does, so the line changed is the one under a card header.
      const lines = note.split("\n");
      let section: string | null = null;
      const at = lines.findIndex((l) => {
        if (isHeaderLine(l)) section = normalizeSection(l.trim());
        if (!isItemLine(l) || section === null || !HEADERS.cartoes?.names.includes(section))
          return false;
        const one = parseNote(l).items[0];
        return one !== undefined && normalizeName(one.description) === key;
      });
      const raw = lines[at] ?? "";
      const dash = raw.indexOf("-", raw.toLowerCase().indexOf("r$") + 2);
      const newAmount = cents(old.amount + op.amount);
      lines[at] = `${raw.slice(0, raw.search(/\S/))}${noteAmount(newAmount)} ${raw.slice(dash)}`;
      const newFormula =
        old.amount === 0
          ? appendTerm(formula, check.terms, op.amount)
          : replaceTerm(formula, old.amount, newAmount);
      if (newFormula === null)
        return { ok: false, reason: "não achei o valor do cartão na fórmula" };
      next = { formula: newFormula, note: lines.join("\n") };
    }
  }
  if (next === null) {
    const section = op.target === "card" ? "cartoes" : op.section;
    next = {
      formula: appendTerm(formula, check.terms, op.amount),
      note: insertLine(note, section, `${noteAmount(op.amount)} - ${description}`),
    };
  }

  // Read our own output back with the same rules: it must be a clean cell worth `after`.
  const reread = checkCell({
    userEnteredValue: { formulaValue: next.formula },
    effectiveValue: { numberValue: after / 100 },
    note: next.note,
  });
  if (!reread.ok || reread.total !== after)
    throw new Error(`planCellEdit produced an inconsistent cell: ${JSON.stringify(next)}`);
  return { ok: true, ...next, before, after };
};
