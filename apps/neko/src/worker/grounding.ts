/**
 * Mia 2's number check: every R$ she writes must have come out of a Neko tool, out of code she ran
 * on those numbers, or out of the owner's own question. What does not is marked, never trusted.
 */

/** The screen a number was read from, so a checked value can lead back to it. */
export type Tela = "hoje" | "faturas" | "mes" | "simular";

export interface Source {
  readonly tela?: Tela | undefined;
  /** `AAAA-MM`, when the number belongs to one month. */
  readonly mes?: string | undefined;
}

/** Every number seen so far, in cents and without sign, with where it was first seen. */
export type Seen = Map<number, Source>;

/** Where each tool's numbers are shown in the app; the month comes from the data itself. */
const TOOL_TELA: Record<string, Tela> = {
  hoje: "hoje",
  periodo: "hoje",
  reserva: "hoje",
  para_lancar: "hoje",
  semana: "hoje",
  faturas: "faturas",
  mes: "mes",
  comparar_meses: "mes",
  gasto_com: "mes",
  resumo_meses: "mes",
  dias_do_mes: "mes",
  simular: "simular",
};

const MONTH = /^\d{4}-\d{2}$/;

const keep = (seen: Seen, reais: number, source: Source) => {
  if (!Number.isFinite(reais)) return;
  const c = Math.round(Math.abs(reais) * 100);
  if (!seen.has(c)) seen.set(c, source);
};

/**
 * The numbers of a Neko tool's answer (JSON in reais). A number inside an object that names its
 * month (`"mes": "2026-09"`) leads to that month; `mes` asked of the tool is the fallback.
 */
export const seeToolResult = (seen: Seen, tool: string, input: unknown, text: string) => {
  const tela = TOOL_TELA[tool];
  const asked = (input as { mes?: unknown } | null)?.mes;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    seeText(seen, text, { tela });
    return;
  }
  const walk = (v: unknown, mes: string | undefined) => {
    if (typeof v === "number") keep(seen, v, { tela, mes });
    else if (Array.isArray(v)) for (const x of v) walk(x, mes);
    else if (v && typeof v === "object") {
      const own = (v as { mes?: unknown }).mes;
      const here = typeof own === "string" && MONTH.test(own) ? own : mes;
      for (const x of Object.values(v)) walk(x, here);
    }
  };
  walk(data, typeof asked === "string" && MONTH.test(asked) ? asked : undefined);
};

/**
 * The numbers of free text: code output (`1234.5`, `1,234.50`) or the owner's question
 * (`R$ 1.234,56`, `2000`). A form that reads two ways keeps both readings.
 */
export const seeText = (seen: Seen, text: string, source: Source = {}) => {
  for (const [token] of text.matchAll(/\d[\d.,]*\d|\d/g)) {
    for (const reais of readings(token)) keep(seen, reais, source);
  }
};

/** The values a digit string can stand for, Brazilian or plain. */
const readings = (token: string): number[] => {
  const dot = token.lastIndexOf(".");
  const comma = token.lastIndexOf(",");
  const plain = (s: string) => Number(s);
  if (dot < 0 && comma < 0) return [plain(token)];
  if (dot >= 0 && comma >= 0) {
    // The later mark is the decimal one: 1.234,56 or 1,234.56.
    return comma > dot
      ? [plain(token.replaceAll(".", "").replace(",", "."))]
      : [plain(token.replaceAll(",", ""))];
  }
  const mark = dot >= 0 ? "." : ",";
  const groups = token.split(mark);
  const thousands = groups.slice(1).every((g) => g.length === 3);
  const out: number[] = [];
  if (thousands) out.push(plain(groups.join("")));
  if (groups.length === 2) out.push(plain(groups.join(".")));
  return out;
};

/** A money value as she writes it: `R$ 1.234,56`, `R$ 1.234`, `−R$ 300`, `R$ -300`. */
const MONEY =
  /[−-]?\s?R\$\s?[−-]?\s?\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?(?!\d)|[−-]?\s?R\$\s?[−-]?\s?\d+(?:,\d{1,2})?(?![\d.])/g;

export interface Checked {
  readonly texto: string;
  readonly conferido: boolean;
  readonly tela?: Tela | undefined;
  readonly mes?: string | undefined;
}

/** Each money value in `text`, as written, and whether it came from somewhere. */
export const checkText = (seen: Seen, text: string): Checked[] => {
  const out = new Map<string, Checked>();
  for (const [raw] of text.matchAll(MONEY)) {
    const texto = raw.trim();
    if (out.has(texto)) continue;
    const digits = texto.replace(/^[^\d]*/, "");
    const cents = Math.round(Math.abs(Number(digits.replaceAll(".", "").replace(",", "."))) * 100);
    const source = find(seen, cents, digits.includes(","));
    out.set(texto, { texto, conferido: source !== null, ...(source ?? {}) });
  }
  return [...out.values()];
};

/**
 * Where a value came from: the exact cents, or, written without cents, any number that rounds or
 * truncates to the same reais.
 */
const find = (seen: Seen, cents: number, exact: boolean): Source | null => {
  const hit = seen.get(cents);
  if (hit) return hit;
  if (exact) return null;
  for (const [c, source] of seen) {
    if (Math.round(c / 100) * 100 === cents || Math.trunc(c / 100) * 100 === cents) return source;
  }
  return null;
};

/** Where a chart's or a board's value (reais) came from, with the same rounding allowance. */
export const sourceOf = (seen: Seen, reais: number): Source | null => {
  const cents = Math.round(Math.abs(reais) * 100);
  return find(seen, cents, cents % 100 !== 0);
};

/** Whether a chart's value (reais) came from somewhere. */
export const seenValue = (seen: Seen, reais: number) => sourceOf(seen, reais) !== null;
