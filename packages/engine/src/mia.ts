import { normalizeName } from "./cards.ts";
import type { LocalDate } from "./date.ts";
import { add, type Cents, cents, sub, ZERO } from "./money.ts";
import type { MonthView, Projection } from "./projection.ts";

/**
 * Mia's tools (specs/004-mia): the model picks one, the engine answers. Every amount goes out as a
 * typed reference, `{ref: "v3", cents, tipo}`, and the model writes `{{v3}}` where it wants the
 * value; the screen formats it. Differences, directions and percents are computed here, never by
 * the model.
 */

/**
 * What a value is, so "{{v3}} a mais" can only wrap a difference: a total, a difference between
 * two periods, a balance, a bill, or a percent.
 */
export type RefKind = "total" | "diferenca" | "saldo" | "fatura" | "percentual";
/** The screen that shows the value, for a tap on it. */
export type RefScreen = "hoje" | "faturas" | "mes";

export interface RefMeta {
  readonly tipo: RefKind;
  /** Short words for what it is, shown when the value is tapped: "Saídas de 2026-09". */
  readonly rotulo: string;
  readonly tela: RefScreen;
  /** `AAAA-MM`, when the value belongs to a month. */
  readonly mes?: string;
}
export interface MoneyRef {
  readonly ref: string;
  readonly cents: Cents;
  readonly tipo: RefKind;
}
export interface PctRef {
  readonly ref: string;
  readonly pct: number;
  readonly tipo: "percentual";
}
export type RefValue = RefMeta & ({ readonly cents: number } | { readonly pct: number });

/** Hands out `v1`, `v2`… in order, continuing after the values of earlier turns. */
export const refBook = (earlier: Readonly<Record<string, RefValue>> = {}) => {
  const values: Record<string, RefValue> = { ...earlier };
  let next = Object.keys(values).length + 1;
  const take = () => {
    while (`v${next}` in values) next++;
    return `v${next++}`;
  };
  return {
    money: (c: number, meta: RefMeta): MoneyRef => {
      const ref = take();
      values[ref] = { ...meta, cents: c };
      return { ref, cents: cents(c), tipo: meta.tipo };
    },
    pct: (n: number, meta: Omit<RefMeta, "tipo">): PctRef => {
      const ref = take();
      values[ref] = { ...meta, tipo: "percentual", pct: n };
      return { ref, pct: n, tipo: "percentual" };
    },
    values: (): Readonly<Record<string, RefValue>> => ({ ...values }),
  };
};
export type RefBook = ReturnType<typeof refBook>;

export const MIA_TOOLS = [
  "periodo",
  "hoje",
  "mes",
  "comparar_meses",
  "gasto_com",
  "faturas",
  "reserva",
] as const;
export type MiaTool = (typeof MIA_TOOLS)[number];

export const MIA_PERIODS = [
  "este_mes",
  "mes_passado",
  "ultimos_3_meses",
  "este_ano",
  "ano_passado",
] as const;

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const keyOf = (m: MonthView) => `${m.year}-${String(m.month).padStart(2, "0")}`;
const TOP_OUTFLOWS = 8;
/** gasto_com reads at most two years at once. */
const MAX_MONTHS = 24;

type Out = Record<string, unknown>;
const err = (erro: string): Out => ({ erro });

const field = (input: unknown, name: string): unknown =>
  typeof input === "object" && input !== null
    ? (input as Record<string, unknown>)[name]
    : undefined;
const monthArg = (input: unknown, name: string): string | null => {
  const v = field(input, name);
  return typeof v === "string" && MONTH.test(v) ? v : null;
};

const monthPlus = (key: string, n: number) => {
  const [y = 0, m = 1] = key.split("-").map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
};

/** Whole percent of b over a; null when a is zero, where a percent says nothing. */
const percent = (a: number, b: number) =>
  a === 0 ? null : Math.round(((b - a) / Math.abs(a)) * 100);

const METRICS = [
  ["entradas", "Entradas", (m: MonthView) => m.entrada],
  ["saidas", "Saídas", (m: MonthView) => m.saida],
  ["diario", "Diário", (m: MonthView) => m.diario],
  ["resultado", "Resultado", (m: MonthView) => m.result],
  ["guardado", "Guardado", (m: MonthView) => m.saved],
  ["custo_de_vida", "Custo de vida", (m: MonthView) => m.livingCost],
] as const;

const situation = (today: LocalDate, key: string) =>
  key < today.slice(0, 7)
    ? "fechado"
    : key === today.slice(0, 7)
      ? "em andamento"
      : "futuro, só o que já está lançado";

/** Sheet points that may leave a month incomplete: Mia says so instead of sounding sure. */
const warnings = (p: Projection, key: string) =>
  p.health.filter((h) => h.date.startsWith(key)).length;

const monthTool = (p: Projection, m: MonthView, book: RefBook): Out => {
  const key = keyOf(m);
  const total = (rotulo: string, c: number) =>
    book.money(c, { tipo: "total", rotulo: `${rotulo} de ${key}`, tela: "mes", mes: key });
  const out: Out = { mes: key, situacao: situation(p.today, key) };
  for (const [name, label, get] of METRICS) out[name] = total(label, get(m));
  out.guardado_pct_das_entradas =
    m.savedShare === null
      ? null
      : book.pct(m.savedShare, {
          rotulo: `Guardado sobre as entradas de ${key}`,
          tela: "mes",
          mes: key,
        });
  out.saldo_inicial = book.money(m.startBalance, {
    tipo: "saldo",
    rotulo: `Saldo no início de ${key}`,
    tela: "mes",
    mes: key,
  });
  out.saldo_final = book.money(m.endSheet, {
    tipo: "saldo",
    rotulo: `Saldo no fim de ${key}`,
    tela: "mes",
    mes: key,
  });
  out.maiores_saidas = m.outflows.slice(0, TOP_OUTFLOWS).map((o) => ({
    nome: o.label,
    valor: total(o.label, o.amount),
    linhas: o.count,
    diferenca_para_o_mes_anterior:
      o.change === null
        ? null
        : book.money(o.change, {
            tipo: "diferenca",
            rotulo: `${o.label}: ${key} menos o mês anterior`,
            tela: "mes",
            mes: key,
          }),
    de_outra_pessoa: o.others,
  }));
  out.pontos_a_conferir_na_planilha = warnings(p, key);
  return out;
};

/**
 * Runs one tool on the projection. Input comes from the model and is checked here again; a bad
 * one gets an error the model can read and correct, never an exception.
 */
export const runMiaTool = (p: Projection, name: string, input: unknown, book: RefBook): Out => {
  const month = (key: string) => p.months.find((m) => keyOf(m) === key);
  switch (name) {
    case "periodo": {
      const what = field(input, "expressao");
      const now = p.today.slice(0, 7);
      const year = Number(now.slice(0, 4));
      const known = MIA_PERIODS.find((x) => x === what);
      if (!known) return err(`Use uma destas expressões: ${MIA_PERIODS.join(", ")}.`);
      const range: Record<(typeof MIA_PERIODS)[number], [string, string]> = {
        este_mes: [now, now],
        mes_passado: [monthPlus(now, -1), monthPlus(now, -1)],
        ultimos_3_meses: [monthPlus(now, -3), monthPlus(now, -1)],
        este_ano: [`${year}-01`, now],
        ano_passado: [`${year - 1}-01`, `${year - 1}-12`],
      };
      const [de, ate] = range[known];
      return { hoje: p.today, de, ate };
    }
    case "hoje": {
      const today = (c: number, rotulo: string, tipo: RefKind) =>
        book.money(c, { tipo, rotulo, tela: "hoje" });
      const saldo =
        p.balanceToday === null ? null : today(p.balanceToday, "Saldo de hoje", "saldo");
      const cs = p.canSpend;
      return {
        hoje: p.today,
        saldo_hoje: saldo,
        // With the Diário previsto on, "Hoje cabem" follows the month, cards and Pix together.
        ritmo_do_mes:
          cs?.mode === "month"
            ? {
                cabe_por_dia: cs.perDay < 0 ? null : today(cs.perDay, "Cabe por dia", "total"),
                gasto_no_mes_ate_ontem: today(cs.accumulated, "Gasto no mês até ontem", "total"),
                previsto_ate_ontem: today(cs.paceExpected, "Diário previsto até ontem", "total"),
                dias_sem_gastar_para_voltar_ao_ritmo: cs.daysBehind,
                dias_ate_o_fim_do_mes: cs.daysLeft,
              }
            : null,
        cartao_principal:
          cs?.mode === "cycle"
            ? {
                nome: cs.card,
                cabe_por_dia: cs.perDay < 0 ? null : today(cs.perDay, "Cabe por dia", "total"),
                passou_do_plano:
                  cs.overBy > 0 ? today(cs.overBy, "Passou do plano do ciclo", "diferenca") : null,
                fatura_aberta: today(cs.accumulated, `Fatura aberta do ${cs.card}`, "fatura"),
                plano_do_ciclo: today(cs.budget, "Plano do ciclo", "total"),
                fecha: cs.closing,
                vence: cs.due,
                dias_ate_fechar: cs.daysLeft,
              }
            : null,
        diario_previsto_por_dia: today(p.dailyForecast, "Diário previsto por dia", "total"),
        proximos_7_dias: p.upcoming.map((u) => ({
          data: u.date,
          descricao: u.description,
          valor: today(u.amount, `${u.description} em ${u.date}`, "total"),
          tipo: u.kind === "income" ? "entrada" : u.kind === "card" ? "fatura" : "conta",
        })),
        pontos_a_conferir_na_planilha: p.health.length,
      };
    }
    case "mes": {
      const key = monthArg(input, "mes");
      if (!key) return err("Use o mês no formato AAAA-MM.");
      const m = month(key);
      return m ? monthTool(p, m, book) : err("A planilha não tem esse mês.");
    }
    case "comparar_meses": {
      const a = monthArg(input, "a");
      const b = monthArg(input, "b");
      if (!a || !b) return err("Use os dois meses no formato AAAA-MM.");
      const ma = month(a);
      const mb = month(b);
      if (!ma || !mb) return err("A planilha não tem um desses meses.");
      const out: Out = { a, b };
      for (const [name, label, get] of METRICS) {
        const va = get(ma);
        const vb = get(mb);
        const diff = sub(vb, va);
        const pct = percent(va, vb);
        out[name] = {
          a: book.money(va, { tipo: "total", rotulo: `${label} de ${a}`, tela: "mes", mes: a }),
          b: book.money(vb, { tipo: "total", rotulo: `${label} de ${b}`, tela: "mes", mes: b }),
          diferenca: book.money(diff, {
            tipo: "diferenca",
            rotulo: `${label}: ${b} menos ${a}`,
            tela: "mes",
            mes: b,
          }),
          direcao: diff > 0 ? "subiu" : diff < 0 ? "caiu" : "igual",
          variacao_pct:
            pct === null
              ? null
              : book.pct(pct, {
                  rotulo: `${label}: variação de ${a} para ${b}`,
                  tela: "mes",
                  mes: b,
                }),
        };
      }
      out.pontos_a_conferir_na_planilha = warnings(p, a) + warnings(p, b);
      return out;
    }
    case "gasto_com": {
      const raw = field(input, "termo");
      const term = typeof raw === "string" ? normalizeName(raw) : "";
      const from = monthArg(input, "de");
      const to = monthArg(input, "ate");
      if (term.length < 2 || !from || !to || from > to)
        return err("Use um termo e os meses de e ate no formato AAAA-MM.");
      const range = p.months.filter((m) => keyOf(m) >= from && keyOf(m) <= to).slice(0, MAX_MONTHS);
      const perMonth = range.flatMap((m) => {
        const hits = m.outflows.filter((o) => normalizeName(o.label).includes(term));
        if (hits.length === 0) return [];
        return [
          {
            mes: keyOf(m),
            cents: add(ZERO, ...hits.map((o) => o.amount)),
            nomes: hits.map((o) => o.label),
          },
        ];
      });
      return {
        termo: raw,
        onde_procurei: "nas saídas da planilha; o diário não tem nomes",
        por_mes: perMonth.map((x) => ({
          mes: x.mes,
          valor: book.money(x.cents, {
            tipo: "total",
            rotulo: `${String(raw)} em ${x.mes}`,
            tela: "mes",
            mes: x.mes,
          }),
          nomes: x.nomes,
        })),
        total: book.money(add(ZERO, ...perMonth.map((x) => x.cents)), {
          tipo: "total",
          rotulo: `${String(raw)} de ${from} a ${to}`,
          tela: "mes",
        }),
        encontrado: perMonth.length > 0,
      };
    }
    case "faturas":
      return {
        cartoes: p.cards.map((c) => ({
          cartao: c.card.name,
          fatura_aberta: book.money(c.onSheet, {
            tipo: "fatura",
            rotulo: `Fatura do ${c.card.name} que vence ${c.cycle.due}`,
            tela: "faturas",
          }),
          fecha: c.cycle.closing,
          fechamento_estimado: c.card.closingEstimated,
          vence: c.cycle.due,
          principal: c.usual,
          de_outra_pessoa: c.others,
        })),
      };
    case "reserva": {
      const r = p.reserve;
      if (!r) return err("Ainda não há um mês fechado para medir a reserva.");
      const m = (c: number, rotulo: string, tipo: RefKind = "total") =>
        book.money(c, { tipo, rotulo, tela: "mes" });
      return {
        custo_de_vida_medio: m(r.cost, "Custo de vida médio"),
        meses_usados_na_media: r.costMonths,
        meta_minima: m(r.min, "Reserva mínima"),
        meta_maxima: m(r.max, "Reserva máxima"),
        guardado: m(r.kept, "Reserva guardada", "saldo"),
        meses_de_custo_cobertos: `${Math.floor(r.coveredTenths / 10)},${r.coveredTenths % 10}`,
      };
    }
    default:
      return err(`Não existe a ferramenta ${name}.`);
  }
};

export type AnswerCheck = { readonly ok: true } | { readonly ok: false; readonly reason: string };

const MONEY = /R\$|\d,\d{2}\b|\d\.\d{2}\b/;
const MATH = /\b(somando|soma de|subtraindo|dá um total|totalizando|multiplicando|dividindo)\b/i;
const COMPARE =
  /\b(subiu|subiram|caiu|caíram|aumentou|aumentaram|diminuiu|diminuíram|a mais|a menos|mais que|menos que|maior que|menor que)\b/i;

/**
 * The model's text before it reaches the screen: no money written by hand, no reference that no
 * tool handed out, no arithmetic of its own, and no comparison without the engine's difference.
 */
export const checkAnswer = (
  text: string,
  known: Readonly<Record<string, RefValue>>,
): AnswerCheck => {
  if (MONEY.test(text)) return { ok: false, reason: "escreveu dinheiro em vez de uma referência" };
  const used = [...text.matchAll(/\{\{(\w+)\}\}/g)].map(([, ref]) => ref ?? "");
  const missing = used.find((ref) => !(ref in known));
  if (missing !== undefined)
    return { ok: false, reason: `usou uma referência que não existe: ${missing}` };
  if (MATH.test(text)) return { ok: false, reason: "fez conta por conta própria" };
  if (
    COMPARE.test(text) &&
    !used.some((ref) => {
      const kind = known[ref]?.tipo;
      return kind === "diferenca" || kind === "percentual";
    })
  )
    return { ok: false, reason: "comparou sem usar a diferença que o comparar_meses devolve" };
  return { ok: true };
};
