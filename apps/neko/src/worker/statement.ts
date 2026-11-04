import {
  billLineDate,
  cents,
  checkStatement,
  localDate,
  normalizeName,
  type StatementProblem,
  type StatementRead,
  todayIn,
} from "@neko/engine";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { StatementAnswer } from "../shared/types.ts";
import type { Env } from "./env.ts";
import {
  CAP_MICRO_USD,
  Message,
  MiaSpendLimit,
  type Model,
  OPUS,
  recordUsage,
  spentThisMonth,
  type Usage,
} from "./mia.ts";
import { getProjection } from "./pipeline.ts";
import { loadSettings, type UserSettings } from "./settings.ts";

/**
 * The bank's own bill, read from the PDF the owner sends (specs/003-open-finance, "Fatura do
 * banco"). Claude copies every line into a fixed shape; the sums decide whether the read is kept:
 * each card's lines must make the total it prints, and the cards the bill's (`checkStatement`).
 * Nothing here writes to the sheet: the lines only fill in what Open Finance left out.
 */

const API = "https://api.anthropic.com/v1/messages";

/** Largest PDF taken, in bytes: a bill is a few hundred KB. */
export const MAX_PDF_BYTES = 5_000_000;

const money = { type: "number" };
const count = { type: ["integer", "null"] };
const LINE = {
  type: "object",
  additionalProperties: false,
  required: ["dia", "mes", "descricao", "valor", "parcela", "parcelas"],
  properties: {
    dia: { type: "integer" },
    mes: { type: "integer" },
    descricao: { type: "string" },
    valor: money,
    parcela: count,
    parcelas: count,
  },
};
export const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["vencimento", "total", "cartoes"],
  properties: {
    vencimento: { type: "string" },
    total: money,
    cartoes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["final", "valor", "saldo_anterior", "pagamentos", "lancamentos"],
        properties: {
          final: { type: "string" },
          valor: money,
          saldo_anterior: money,
          pagamentos: money,
          lancamentos: { type: "array", items: LINE },
        },
      },
    },
  },
};

const SYSTEM = `Você lê a fatura de cartão de crédito que o dono baixou do banco e copia cada \
lançamento exatamente como está impresso, sem somar, juntar, corrigir nem inventar nada.

- vencimento: a data de vencimento da fatura, AAAA-MM-DD.
- total: o total da fatura impresso, em reais (número, negativo se for crédito).
- cartoes: um por cartão (titular e adicionais), na ordem da fatura. final: os 4 últimos \
dígitos. valor: o "Valor da fatura" impresso para esse cartão, com o sinal. saldo_anterior: o \
"SALDO ANTERIOR" listado nesse cartão (0 se não houver). pagamentos: a soma dos pagamentos de \
faturas anteriores listados nesse cartão, como número positivo (0 se não houver).
- lancamentos: todas as outras linhas do cartão, uma por linha impressa, mesmo duas iguais no \
mesmo dia. Nunca ponha o SALDO ANTERIOR nem pagamentos de fatura aqui. dia e mes: a data da \
linha (mes de 1 a 12); uma linha sem data tem a data da linha de cima. valor: positivo para \
compra ou tarifa, negativo para crédito ou estorno (como "-159,90"). parcela e parcelas: de \
"( 05/12 )" vêm 5 e 12; sem parcela, null.
- Ignore a seção de lançamentos programados, os limites, as taxas e os textos legais.`;

const Raw = z.object({
  vencimento: z.string(),
  total: z.number(),
  cartoes: z.array(
    z.object({
      final: z.string(),
      valor: z.number(),
      saldo_anterior: z.number(),
      pagamentos: z.number(),
      lancamentos: z.array(
        z.object({
          dia: z.number().int(),
          mes: z.number().int(),
          descricao: z.string(),
          valor: z.number(),
          parcela: z.number().int().nullable(),
          parcelas: z.number().int().nullable(),
        }),
      ),
    }),
  ),
});

const toCents = (reais: number) => cents(Math.round(reais * 100));

/** What Claude read, in the engine's terms: cents, full dates, a parcel only when it has two or more. */
export const fromRaw = (raw: z.infer<typeof Raw>): StatementRead => {
  const due = localDate(raw.vencimento);
  return {
    due,
    total: toCents(raw.total),
    cards: raw.cartoes.map((c) => ({
      number: c.final.replace(/\D/g, "").slice(-4),
      total: toCents(c.valor),
      previous: toCents(c.saldo_anterior),
      paid: toCents(Math.abs(c.pagamentos)),
      lines: c.lancamentos.map((l) => {
        const parcel = (l.parcelas ?? 1) > 1 && l.parcela !== null;
        return {
          date: billLineDate(due, l.mes, l.dia),
          description: l.descricao.replace(/\s+/g, " ").trim(),
          amount: toCents(l.valor),
          installment: parcel ? l.parcela : null,
          installments: parcel ? l.parcelas : null,
        };
      }),
    })),
  };
};

export interface ReaderDeps {
  readonly fetch: typeof fetch;
  readonly key: string;
  readonly record: (model: Model, usage: Usage) => Promise<void>;
}

/** One read at one effort; null when Claude refused, ran out of room or gave a shape not usable. */
const readOnce = async (
  deps: ReaderDeps,
  pdf: string,
  effort: "medium" | "high",
): Promise<StatementRead | null> => {
  const res = await deps.fetch(API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": deps.key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: OPUS,
      max_tokens: 32000,
      output_config: { effort, format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: pdf },
            },
            { type: "text", text: "Leia esta fatura." },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    if ((res.status === 400 || res.status === 429) && /spend|credit|billing/i.test(body))
      throw new MiaSpendLimit(`anthropic ${res.status}`);
    // A PDF the API cannot open (password, damaged) is the owner's to fix, not an outage.
    if (res.status === 400 && /pdf|document/i.test(body)) {
      console.error("statement pdf refused", body.slice(0, 300));
      return null;
    }
    throw new Error(`anthropic ${res.status}`);
  }
  const msg = Message.parse(await res.json());
  await deps.record(OPUS, {
    input_tokens: msg.usage.input_tokens,
    output_tokens: msg.usage.output_tokens,
    cache_creation_input_tokens: msg.usage.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: msg.usage.cache_read_input_tokens ?? 0,
  });
  if (msg.stop_reason !== "end_turn") return null;
  const text = msg.content.find((b) => b.type === "text" && "text" in b);
  try {
    const raw = Raw.safeParse(JSON.parse(text && "text" in text ? String(text.text) : ""));
    return raw.success ? fromRaw(raw.data) : null;
  } catch {
    return null;
  }
};

export type ReadResult =
  | { readonly kind: "ok"; readonly read: StatementRead }
  | { readonly kind: "wrong"; readonly problems: readonly StatementProblem[] }
  | { readonly kind: "unreadable" };

/** Read, and read again more carefully when the sums do not close; kept only when they do. */
export const readStatement = async (deps: ReaderDeps, pdf: string): Promise<ReadResult> => {
  let problems: StatementProblem[] = [];
  for (const effort of ["medium", "high"] as const) {
    const read = await readOnce(deps, pdf, effort);
    if (!read) continue;
    problems = checkStatement(read);
    if (problems.length === 0) return { kind: "ok", read };
  }
  return problems.length > 0 ? { kind: "wrong", problems } : { kind: "unreadable" };
};

const last4 = (s: string | null) => (s ? s.replace(/\D/g, "").slice(-4) : "");

/**
 * The card account a bill belongs to: the one whose cards (in Ajustes › Bancos) or own number
 * share the most numbers with the bill. None, or a tie, is not guessed.
 */
export const statementAccount = (
  read: StatementRead,
  accounts: readonly { readonly id: string; readonly number: string | null }[],
  map: UserSettings["bankCards"],
): string | null => {
  const numbers = new Set(read.cards.map((c) => c.number));
  const scored = accounts
    .map((a) => {
      const known = new Set([
        last4(a.number),
        ...map.filter((m) => m.accountId === a.id).map((m) => m.cardNumber ?? ""),
      ]);
      return { id: a.id, score: [...numbers].filter((n) => known.has(n)).length };
    })
    .filter((a) => a.score > 0)
    .sort((a, b) => b.score - a.score);
  const [best, next] = scored;
  return best && best.score !== next?.score ? best.id : null;
};

/** A newer read of the same bill replaces the older one. */
export const saveStatement = async (
  db: D1Database,
  accountId: string,
  read: StatementRead,
  at: Date,
): Promise<void> => {
  const month = read.due.slice(0, 7);
  const lines = read.cards.flatMap((c) => c.lines.map((l) => ({ ...l, number: c.number })));
  await db.batch([
    db
      .prepare("DELETE FROM statement_line WHERE account_id = ? AND bill_month = ?")
      .bind(accountId, month),
    db
      .prepare("DELETE FROM statement WHERE account_id = ? AND bill_month = ?")
      .bind(accountId, month),
    db
      .prepare("INSERT INTO statement (account_id, bill_month, total, read_at) VALUES (?, ?, ?, ?)")
      .bind(accountId, month, read.total, at.toISOString()),
    ...lines.map((l, seq) =>
      db
        .prepare(
          `INSERT INTO statement_line (account_id, bill_month, seq, card_number, date, description,
           amount, installment, installments) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          accountId,
          month,
          seq,
          l.number,
          l.date,
          l.description,
          l.amount,
          l.installment,
          l.installments,
        ),
    ),
  ]);
};

/** A bill PDF, base64; the decoded file at most MAX_PDF_BYTES. */
const StatementPost = z.object({
  pdf: z
    .string()
    .min(100)
    .max(Math.ceil(MAX_PDF_BYTES / 3) * 4),
});

const nextMonthStart = (today: string) => {
  const [y = 0, m = 1] = today.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
};

/**
 * Reads the bank's bill PDF and keeps it when its sums close, from Faturas or from the e-mail the
 * bank sends. Answers which lines the feed did not have, so the owner sees what the PDF brought;
 * a read not kept is an answer too (with why), not an error.
 */
export const takeStatement = async (env: Env, body: unknown): Promise<StatementAnswer> => {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) throw new HTTPException(404);
  const parsed = StatementPost.safeParse(body);
  if (!parsed.success) throw new HTTPException(400);
  const now = new Date();
  const today = todayIn(now);
  const paused: StatementAnswer = {
    read: false,
    reason: "paused",
    pausedUntil: nextMonthStart(today),
  };
  if ((await spentThisMonth(env.DB, today)) >= CAP_MICRO_USD) return paused;
  let result: ReadResult;
  try {
    result = await readStatement(
      { fetch, key, record: recordUsage(env.DB, today, now) },
      parsed.data.pdf,
    );
  } catch (e) {
    if (e instanceof MiaSpendLimit) return paused;
    throw e;
  }
  if (result.kind === "unreadable") return { read: false, reason: "unreadable" };
  if (result.kind === "wrong")
    return { read: false, reason: "mismatch", problems: [...result.problems] };
  const { read } = result;
  const settings = await loadSettings(env.DB);
  const accounts = await env.DB.prepare(
    "SELECT id, number FROM bank_account WHERE type = 'CREDIT'",
  ).all<{ id: string; number: string | null }>();
  const account = statementAccount(read, accounts.results, settings.bankCards);
  if (!account) return { read: false, reason: "account" };
  await saveStatement(env.DB, account, read, now);
  const month = read.due.slice(0, 7);
  const names = new Set(
    settings.bankCards.filter((m) => m.accountId === account).map((m) => normalizeName(m.card)),
  );
  const { bank } = await getProjection(env, today);
  const added = (bank?.checks ?? [])
    .filter((c) => c.due.slice(0, 7) === month && names.has(normalizeName(c.card)))
    .flatMap((c) =>
      c.lines
        .filter((l) => l.fromStatement)
        .map((l) => ({ card: c.card, description: l.description, amount: l.amount })),
    );
  return {
    read: true,
    due: read.due,
    cards: read.cards.length,
    lines: read.cards.reduce((n, c) => n + c.lines.length, 0),
    added,
  };
};
