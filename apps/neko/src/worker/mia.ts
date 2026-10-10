import {
  checkAnswer,
  entryFromMia,
  type LocalDate,
  MIA_ENTRY_TYPES,
  MIA_PERIODS,
  type MiaEntry,
  type Projection,
  type RefValue,
  refBook,
  runMiaTool,
} from "@neko/engine";
import { z } from "zod";

/**
 * Mia over the Messages API (specs/004-mia): Haiku answers first, Sonnet when Haiku asks, refuses
 * or fails the check twice. Tools run in the engine; the model only points at their values.
 * Raw `fetch`, no SDK: every response is parsed here.
 */

const API = "https://api.anthropic.com/v1/messages";
export const HAIKU = "claude-haiku-5-5";
export const SONNET = "claude-sonnet-5-5";
type Model = typeof HAIKU | typeof SONNET;

/** Calls to the API in one attempt, tool rounds and the answer included. */
const MAX_CALLS = 4;
/** Earlier exchanges sent back with a question. */
export const MAX_HISTORY = 6;
const MAX_TOKENS: Record<Model, number> = { [HAIKU]: 2000, [SONNET]: 4000 };
const EFFORT: Record<Model, string> = { [HAIKU]: "low", [SONNET]: "medium" };

/** Monthly cap in millionths of a dollar; the Console workspace limit sits at the same US$ 80. */
export const CAP_MICRO_USD = 80_000_000;
/** Past this share of the cap, Mia stops escalating to Sonnet. */
const NO_ESCALATION_AT = 0.7;

/** US$ per million tokens, from the official price page: input, cache write (5 min), read, output. */
const PRICES: Record<Model, readonly [number, number, number, number]> = {
  [HAIKU]: [0.1, 0.125, 0.01, 0.5],
  [SONNET]: [2, 2.5, 0.1, 10],
};
/** Haiku 5.5 costs five times as much past this many prompt tokens. */
const HAIKU_STEP = 100_000;

export interface Usage {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cache_creation_input_tokens: number;
  readonly cache_read_input_tokens: number;
}

/** A call's price in millionths of a dollar, rounded up so the cap errs on the safe side. */
export const costMicroUsd = (model: Model, u: Usage): number => {
  const prompt = u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens;
  const step = model === HAIKU && prompt > HAIKU_STEP ? 5 : 1;
  const [inp, write, read, out] = PRICES[model];
  return Math.ceil(
    step *
      (u.input_tokens * inp +
        u.cache_creation_input_tokens * write +
        u.cache_read_input_tokens * read +
        u.output_tokens * out),
  );
};

const SYSTEM = `Você é a Mia, a gata que ajuda o dono do Neko a entender a própria planilha de \
finanças, no método da Escola do Breno. Fale em português do Brasil, curto e gentil, como numa \
conversa.

Regras que nunca mudam:
- Você só sabe o que as ferramentas devolvem. Consulte uma ferramenta antes de falar de qualquer \
número.
- Nunca escreva valores em dinheiro nem percentuais. Cada valor das ferramentas vem com uma \
referência, como {"ref": "v3"}; escreva {{v3}} no texto e a tela mostra o valor.
- Nunca faça conta: não some, não subtraia, não divida. Para comparar meses use comparar_meses e \
cite a diferença ou a variação que ela devolve.
- Não preveja nada: nem salário, nem reajuste, nem gasto futuro. Fale só do que a planilha já tem.
- Você não muda a planilha nem os ajustes.
- Se as ferramentas não cobrem a pergunta, diga com franqueza o que você não consegue ver.
- Se a ferramenta disser que há pontos a conferir na planilha, avise que o número pode mudar.
- Para "mês passado", "este ano" e afins, use a ferramenta periodo.
- Termine sempre com a ferramenta responder. Use precisa_escalar só quando a pergunta pede um \
raciocínio que você não consegue fazer com segurança.`;

const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const month = (description: string) => ({ type: "string", description });

/** Fixed byte for byte, so the prompt prefix stays cached. */
export const TOOLS = [
  {
    name: "periodo",
    description: "Converte um período em palavras nos meses AAAA-MM de início e fim.",
    input_schema: obj({ expressao: { type: "string", enum: [...MIA_PERIODS] } }),
  },
  {
    name: "hoje",
    description:
      "Saldo de hoje, quanto cabe por dia no cartão principal, a fatura aberta, o diário previsto e o que vence nos próximos 7 dias.",
    input_schema: obj({}),
  },
  {
    name: "mes",
    description:
      "Um mês da planilha: entradas, saídas, diário, resultado, guardado, custo de vida, saldos e as maiores saídas.",
    input_schema: obj({ mes: month("Mês no formato AAAA-MM.") }),
  },
  {
    name: "comparar_meses",
    description:
      "Compara dois meses: cada número dos dois, a diferença (b menos a), a direção e a variação em percentual.",
    input_schema: obj({ a: month("Mês anterior, AAAA-MM."), b: month("Mês posterior, AAAA-MM.") }),
  },
  {
    name: "gasto_com",
    description:
      "Quanto saiu com um nome (mercado, aluguel, um cartão) entre dois meses, mês a mês e no total. Procura nas saídas; o diário não tem nomes.",
    input_schema: obj({
      termo: { type: "string" },
      de: month("Primeiro mês, AAAA-MM."),
      ate: month("Último mês, AAAA-MM."),
    }),
  },
  {
    name: "faturas",
    description: "Cada cartão: a fatura aberta, o fechamento e o vencimento.",
    input_schema: obj({}),
  },
  {
    name: "reserva",
    description: "A reserva de emergência: custo de vida médio, metas e quanto está guardado.",
    input_schema: obj({}),
  },
  {
    name: "responder",
    description: "A resposta final ao dono, com as referências {{vN}} no lugar dos valores.",
    input_schema: obj({ texto: { type: "string" }, precisa_escalar: { type: "boolean" } }),
  },
].map((t) => ({ ...t, strict: true }));

const ContentBlock = z.union([
  z.object({ type: z.literal("text"), text: z.string() }).loose(),
  z
    .object({
      type: z.literal("tool_use"),
      id: z.string(),
      name: z.string(),
      input: z.unknown(),
    })
    .loose(),
  z.object({ type: z.string() }).loose(),
]);

const Message = z.object({
  content: z.array(ContentBlock),
  stop_reason: z.string().nullable(),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    cache_creation_input_tokens: z.number().int().nonnegative().nullish(),
    cache_read_input_tokens: z.number().int().nonnegative().nullish(),
  }),
});

const Answer = z.object({ texto: z.string().min(1).max(2000), precisa_escalar: z.boolean() });

const RefValueSchema = z.union([
  z.object({
    tipo: z.enum(["total", "diferenca", "saldo", "fatura"]),
    rotulo: z.string().max(200),
    tela: z.enum(["hoje", "faturas", "mes"]),
    mes: z.string().max(7).exactOptional(),
    cents: z.number().int(),
  }),
  z.object({
    tipo: z.literal("percentual"),
    rotulo: z.string().max(200),
    tela: z.enum(["hoje", "faturas", "mes"]),
    mes: z.string().max(7).exactOptional(),
    pct: z.number().int(),
  }),
]);

/** What the screen sends: the question and the last exchanges, with the values they showed. */
export const MiaRequest = z.object({
  pergunta: z.string().trim().min(1).max(500),
  historico: z
    .array(z.object({ pergunta: z.string().max(500), resposta: z.string().max(2000) }))
    .max(MAX_HISTORY)
    .default([]),
  valores: z.record(z.string().regex(/^v\d{1,4}$/), RefValueSchema).default({}),
});
export type MiaRequest = z.infer<typeof MiaRequest>;

export interface MiaAnswer {
  readonly texto: string;
  /** Only the values the text cites, for the screen to format and link. */
  readonly valores: Readonly<Record<string, RefValue>>;
  readonly modelo: Model | null;
}

/** The API said no for money reasons: the workspace limit or no credit left. */
export class MiaSpendLimit extends Error {}

export interface MiaDeps {
  readonly fetch: typeof fetch;
  readonly key: string;
  /** Spent this month, in millionths of a dollar, before this question. */
  readonly spentMicroUsd: number;
  readonly record: (model: Model, usage: Usage) => Promise<void>;
}

/** Said when no model gave a safe answer: no number, and where to look instead. */
export const FALLBACK =
  "Não consegui responder isso com segurança agora. Os números estão nas telas Hoje, Mês e Faturas.";

type Block = z.infer<typeof ContentBlock>;
type Turn = { role: "user" | "assistant"; content: string | readonly unknown[] };

/** The conversation's prompt and tools; Lançar com a Mia brings its own. */
interface Setup {
  readonly system: string;
  readonly tools: readonly unknown[];
  readonly tool_choice: unknown;
}

const call = async (
  deps: MiaDeps,
  model: Model,
  messages: readonly Turn[],
  setup: Setup = {
    system: SYSTEM,
    tools: TOOLS,
    // Haiku can be made to always call a tool, so it always ends in responder.
    tool_choice: model === HAIKU ? { type: "any" } : { type: "auto" },
  },
) => {
  const res = await deps.fetch(API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": deps.key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS[model],
      output_config: { effort: EFFORT[model] },
      system: [{ type: "text", text: setup.system, cache_control: { type: "ephemeral" } }],
      tools: setup.tools,
      tool_choice: setup.tool_choice,
      messages,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    if ((res.status === 400 || res.status === 429) && /spend|credit|billing/i.test(body))
      throw new MiaSpendLimit(`anthropic ${res.status}`);
    throw new Error(`anthropic ${res.status}`);
  }
  const msg = Message.parse(await res.json());
  const usage: Usage = {
    input_tokens: msg.usage.input_tokens,
    output_tokens: msg.usage.output_tokens,
    cache_creation_input_tokens: msg.usage.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: msg.usage.cache_read_input_tokens ?? 0,
  };
  await deps.record(model, usage);
  return msg;
};

const isToolUse = (b: Block): b is Block & { id: string; name: string; input: unknown } =>
  b.type === "tool_use" && "id" in b && "name" in b;

type Attempt =
  | { readonly kind: "answer"; readonly texto: string; readonly valores: Record<string, RefValue> }
  | { readonly kind: "escalate" };

/** One model's try: tool rounds until it answers with text that passes the check. */
const attempt = async (
  deps: MiaDeps,
  model: Model,
  p: Projection,
  today: LocalDate,
  req: MiaRequest,
): Promise<Attempt> => {
  const book = refBook(req.valores);
  const messages: Turn[] = [
    ...req.historico.flatMap((h): Turn[] => [
      { role: "user", content: h.pergunta },
      { role: "assistant", content: h.resposta },
    ]),
    { role: "user", content: `[hoje: ${today}] ${req.pergunta}` },
  ];
  let failed = 0;
  for (let i = 0; i < MAX_CALLS; i++) {
    const msg = await call(deps, model, messages);
    if (msg.stop_reason === "refusal") return { kind: "escalate" };
    // The reply goes back unchanged, thinking blocks included.
    messages.push({ role: "assistant", content: msg.content });
    const uses = msg.content.filter(isToolUse);
    if (uses.length === 0) {
      // Sonnet may answer in plain text; it goes through the same check.
      const text = msg.content.flatMap((b) => (b.type === "text" && "text" in b ? [b.text] : []));
      const texto = text.join("").trim();
      if (!texto) return { kind: "escalate" };
      const check = checkAnswer(texto, book.values());
      if (check.ok) return { kind: "answer", texto, valores: cited(texto, book.values()) };
      if (++failed >= 2) return { kind: "escalate" };
      messages.push({
        role: "user",
        content: `Sua resposta foi recusada: ${check.reason}. Responda de novo com a ferramenta responder.`,
      });
      continue;
    }
    const results: unknown[] = [];
    for (const use of uses) {
      if (use.name !== "responder") {
        const out = runMiaTool(p, use.name, use.input, book);
        results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(out) });
        continue;
      }
      const parsed = Answer.safeParse(use.input);
      if (!parsed.success) {
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          is_error: true,
          content: "Envie texto e precisa_escalar.",
        });
        continue;
      }
      if (parsed.data.precisa_escalar) return { kind: "escalate" };
      const check = checkAnswer(parsed.data.texto, book.values());
      if (check.ok)
        return {
          kind: "answer",
          texto: parsed.data.texto,
          valores: cited(parsed.data.texto, book.values()),
        };
      if (++failed >= 2) return { kind: "escalate" };
      results.push({
        type: "tool_result",
        tool_use_id: use.id,
        is_error: true,
        content: `Resposta recusada: ${check.reason}. Corrija e chame responder de novo.`,
      });
    }
    messages.push({ role: "user", content: results });
  }
  return { kind: "escalate" };
};

const cited = (texto: string, all: Readonly<Record<string, RefValue>>) => {
  const out: Record<string, RefValue> = {};
  for (const [, ref = ""] of texto.matchAll(/\{\{(\w+)\}\}/g)) {
    const v = all[ref];
    if (v) out[ref] = v;
  }
  return out;
};

/** Haiku first; Sonnet when Haiku cannot, unless the month's spending is near the cap. */
export const askMia = async (
  deps: MiaDeps,
  p: Projection,
  today: LocalDate,
  req: MiaRequest,
): Promise<MiaAnswer> => {
  const first = await attempt(deps, HAIKU, p, today, req);
  if (first.kind === "answer") return { texto: first.texto, valores: first.valores, modelo: HAIKU };
  if (deps.spentMicroUsd >= CAP_MICRO_USD * NO_ESCALATION_AT)
    return { texto: FALLBACK, valores: {}, modelo: null };
  const second = await attempt(deps, SONNET, p, today, req);
  return second.kind === "answer"
    ? { texto: second.texto, valores: second.valores, modelo: SONNET }
    : { texto: FALLBACK, valores: {}, modelo: null };
};

const ENTRY_SYSTEM = `Você é a Mia, do Neko. O dono descreve numa frase algo que gastou ou recebeu, \
e você preenche o formulário de lançamento da planilha dele, no método da Escola do Breno. Você não \
grava nada: ele confere e lança.

- tipo: "pix" para Pix, débito ou dinheiro (vai no Diário); "entrada" para dinheiro que chegou \
(salário, reembolso, Pix recebido); "conta" para conta fixa ou boleto (aluguel, luz, internet, \
escola); "cartao" para compra no cartão de crédito; "nao_entendi" se a frase não é um lançamento.
- valor: em reais, como 45.9. Use 0 se a frase não diz o valor.
- dia: AAAA-MM-DD. A frase traz a data de hoje; "ontem", "sexta" e afins contam a partir dela. \
Sem dia na frase, use hoje.
- nome: curto, como numa planilha: "Padaria", "Uber", "Salário". Vazio se não der para saber.
- cartao: só com tipo "cartao", exatamente um dos cartões listados na frase; vazio se não der para \
saber qual.
- parcelas: 1 à vista, ou o número de parcelas que a frase disser.`;

export const ENTRY_TOOL = {
  name: "lancamento",
  description: "Os campos do lançamento que a frase descreve.",
  input_schema: obj({
    tipo: { type: "string", enum: [...MIA_ENTRY_TYPES] },
    valor: { type: "number" },
    dia: { type: "string" },
    nome: { type: "string" },
    cartao: { type: "string" },
    parcelas: { type: "integer" },
  }),
  strict: true,
};

/** What the screen sends: the sentence and the cards it offers in Lançar à mão. */
export const MiaEntryRequest = z.object({
  frase: z.string().trim().min(1).max(300),
  cartoes: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
});
export type MiaEntryRequest = z.infer<typeof MiaEntryRequest>;

/** One Haiku call that must fill the form; the engine keeps only the fields it can trust. */
export const fillEntry = async (
  deps: MiaDeps,
  today: LocalDate,
  req: MiaEntryRequest,
): Promise<MiaEntry | null> => {
  const cards = req.cartoes.length ? req.cartoes.join(", ") : "nenhum";
  const msg = await call(
    deps,
    HAIKU,
    [{ role: "user", content: `[hoje: ${today}] [cartões: ${cards}] ${req.frase}` }],
    {
      system: ENTRY_SYSTEM,
      tools: [ENTRY_TOOL],
      tool_choice: { type: "tool", name: "lancamento" },
    },
  );
  const use = msg.content.find(isToolUse);
  return use ? entryFromMia(use.input, today, req.cartoes) : null;
};

/** `AAAA-MM` of a day, the ledger's month. */
export const ledgerMonth = (today: LocalDate) => today.slice(0, 7);

export const spentThisMonth = async (db: D1Database, today: LocalDate): Promise<number> => {
  const row = await db
    .prepare("SELECT COALESCE(SUM(micro_usd), 0) AS spent FROM mia_usage WHERE month = ?")
    .bind(ledgerMonth(today))
    .first<{ spent: number }>();
  return Number(row?.spent ?? 0);
};

export const recordUsage =
  (db: D1Database, today: LocalDate, at: Date) =>
  async (model: Model, u: Usage): Promise<void> => {
    await db
      .prepare(
        `INSERT INTO mia_usage (at, month, model, input_tokens, output_tokens, cache_write_tokens,
         cache_read_tokens, micro_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        at.toISOString(),
        ledgerMonth(today),
        model,
        u.input_tokens,
        u.output_tokens,
        u.cache_creation_input_tokens,
        u.cache_read_input_tokens,
        costMicroUsd(model, u),
      )
      .run();
  };
