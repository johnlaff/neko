/**
 * Mia 2: an Anthropic managed agent that reads the Neko through its MCP tools (mcp.ts), does sums
 * in her sandbox and draws charts in the conversation. This Worker makes her objects once, opens a
 * conversation per "Nova conversa", relays what she does as NDJSON lines, checks every R$ she
 * writes (grounding.ts) and books what each conversation costs against the month's cap. She reads
 * only: nothing here writes to the sheet.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { AgentCreateParams } from "@anthropic-ai/sdk/resources/beta/agents/agents";
import type { BetaManagedAgentsStreamSessionEvents as StreamEvent } from "@anthropic-ai/sdk/resources/beta/sessions/events";
import type { LocalDate } from "@neko/engine";
import { z } from "zod";
import type { Mia2Grafico, Mia2Line, Mia2Numero, Mia2Valor } from "../shared/types.ts";
import { checkText, type Seen, seenValue, seeText, seeToolResult, sourceOf } from "./grounding.ts";
import { CAP_MICRO_USD, ledgerMonth } from "./mia.ts";

export const MIA2_MODEL = "claude-sonnet-5-5";
/** What one conversation may spend, in US cents, inside the month's cap. */
export const SESSION_CAP_CENTS = 200;
/** A question that runs longer than this is stopped and said to have failed. */
export const TURN_MS = 240_000;
export const CHART_TOOL = "mostrar_grafico";
export const NUMBERS_TOOL = "mostrar_numeros";

export const SYSTEM = `Você é a Mia, a assistente do Neko. O Neko lê a planilha financeira do dono, preenchida à mão no método do gasto diário, e mostra o dia, as faturas, os meses e a reserva. Você conversa com o dono em português do Brasil.

De onde vêm os números
- Todo valor em R$ que você escrever precisa ter saído de uma ferramenta do Neko ou de uma conta que você fez no bash sobre esses números. O Neko confere cada valor e marca o que não tiver origem.
- Faça somas, médias e diferenças no bash (python3), nunca de cabeça.
- Escreva valores como R$ 1.234,56, ou R$ 1.234 quando arredondar. Nunca "mil" ou "k".
- A planilha é a fonte da verdade. Você não prevê o futuro por conta própria: para "e se" e para como os próximos meses podem ficar, use a ferramenta simular e diga que é uma simulação, sem nada salvo.
- Você não escreve na planilha. Quando o dono pedir para lançar algo que contou, use propor_lancamento, um lançamento por chamada, e diga numa frase que ficou em Para lançar e só entra na planilha quando ele tocar em Lançar. Se faltar o valor ou como pagou, pergunte antes.
- Para saber a data de hoje, use a ferramenta hoje.

Como responder
- O dono lê no celular, de relance. A resposta vem numa frase só, com o número principal em negrito.
- Depois, só se ajudar, até 3 itens de uma linha, cada um com no máximo um valor. O texto nunca passa de 60 palavras.
- Números que o dono vai comparar de relance (2 a 4) vão em ${NUMBERS_TOOL}, não em lista no texto. Num resumo ou em "como estou", mostre ali os 3 ou 4 que mais importam, como o saldo, quanto ainda cabe no teto, as faturas abertas e a reserva.
- Uma série no tempo ou uma comparação de 3 ou mais pontos vai em ${CHART_TOOL}. Com entradas e saídas no mesmo gráfico, entradas vêm primeiro.
- No máximo um quadro de números e um gráfico por resposta, e o texto não repete os valores deles.
- Sem títulos e sem tabelas. Negrito só no número principal.
- Não conte o que vai fazer nem quais ferramentas usou.
- Se a ferramenta não tiver o dado, diga isso em vez de supor.
- Use as palavras do Neko: teto (o limite do mês para cartões e Pix), fatura, reserva, Para lançar.
- A reserva sobe em degraus, como no Mês: R$ 3.000, depois 1, 3, 6 e 12 meses de custo de vida. Fale do próximo degrau e de quanto falta para ele. As metas de 6 e 12 meses, só se o dono perguntar.

Memória
- Guarde na memória só fatos duráveis que o dono contar: quem é quem, preferências, combinados. Nunca valores que mudam (esses vêm das ferramentas) nem senhas.`;

/** The chart she may draw: money over time (linha) or side by side (barras), in reais. */
export const Chart = z
  .object({
    titulo: z.string().trim().min(1).max(80),
    tipo: z.enum(["linha", "barras"]),
    rotulos: z.array(z.string().trim().min(1).max(20)).min(2).max(36),
    series: z
      .array(
        z.object({
          nome: z.string().trim().min(1).max(40),
          valores: z.array(z.number().finite()),
        }),
      )
      .min(1)
      .max(3),
    nota: z.string().trim().max(160).optional(),
  })
  .refine((c) => c.series.every((s) => s.valores.length === c.rotulos.length), {
    message: "cada série precisa de um valor por rótulo",
  });

/** Her board of numbers: two to four values in reais, a short label over each. */
export const Numbers = z.object({
  itens: z
    .array(
      z.object({
        rotulo: z.string().trim().min(1).max(28),
        valor: z.number().finite(),
        nota: z.string().trim().max(32).optional(),
      }),
    )
    .min(2)
    .max(4),
});

const NUMBERS_SCHEMA = {
  type: "object" as const,
  properties: {
    itens: {
      type: "array",
      description: "De 2 a 4 números, na ordem de importância.",
      items: {
        type: "object",
        properties: {
          rotulo: {
            type: "string",
            description:
              "O que o número é, curto (até 28 letras), como 'Saldo hoje' ou 'Cabe no teto'.",
          },
          valor: { type: "number", description: "O valor em reais, negativo quando falta." },
          nota: {
            type: "string",
            description: "Opcional, bem curto (até 32 letras), como 'até 26/11' ou 'vence 12/12'.",
          },
        },
        required: ["rotulo", "valor"],
      },
    },
  },
  required: ["itens"],
};

const CHART_SCHEMA = {
  type: "object" as const,
  properties: {
    titulo: { type: "string", description: "O que o gráfico mostra, curto (até 80 letras)." },
    tipo: {
      type: "string",
      enum: ["linha", "barras"],
      description: "linha para valores no tempo; barras para comparar lado a lado.",
    },
    rotulos: {
      type: "array",
      items: { type: "string" },
      description: "Rótulos do eixo x, curtos, como 'set 2026' ou '12/11'. De 2 a 36.",
    },
    series: {
      type: "array",
      description: "De 1 a 3 séries, cada uma com um valor em reais por rótulo.",
      items: {
        type: "object",
        properties: {
          nome: { type: "string" },
          valores: { type: "array", items: { type: "number" } },
        },
        required: ["nome", "valores"],
      },
    },
    nota: { type: "string", description: "Opcional: a leitura do gráfico em uma frase." },
  },
  required: ["titulo", "tipo", "rotulos", "series"],
};

/** Her definition; a change here makes a new version of the agent on the next question. */
export const agentConfig = (site: string): AgentCreateParams => ({
  name: "Mia",
  description: "A assistente do Neko: lê a planilha pelo Neko, faz contas e desenha gráficos.",
  model: { id: MIA2_MODEL, effort: "medium" },
  system: SYSTEM,
  mcp_servers: [{ type: "url", name: "neko", url: `${site}/api/mcp` }],
  tools: [
    {
      type: "agent_toolset_20260401",
      default_config: { enabled: true, permission_policy: { type: "always_allow" } },
      configs: [
        { name: "web_fetch", enabled: false },
        { name: "web_search", enabled: false },
      ],
    },
    {
      type: "mcp_toolset",
      mcp_server_name: "neko",
      default_config: { permission_policy: { type: "always_allow" } },
    },
    {
      type: "custom",
      name: CHART_TOOL,
      description:
        "Mostra um gráfico na conversa, desenhado pelo Neko. Use só valores em reais que vieram das ferramentas ou de contas no bash; o Neko recusa valores sem origem.",
      input_schema: CHART_SCHEMA,
    },
    {
      type: "custom",
      name: NUMBERS_TOOL,
      description:
        "Mostra de 2 a 4 números lado a lado na conversa, um rótulo curto em cima de cada valor, desenhados pelo Neko. Use só valores em reais que vieram das ferramentas ou de contas no bash; o Neko recusa valores sem origem.",
      input_schema: NUMBERS_SCHEMA,
    },
  ],
});

const MEMORY_NOTE =
  "Fatos duráveis sobre o dono e como ele gosta das respostas. Leia antes de responder a primeira pergunta.";

export interface Mia2Setup {
  readonly environment: string;
  readonly memoryStore: string;
  readonly vault: string;
  readonly agent: string;
  readonly version: number;
}

const sha256 = async (text: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

/**
 * Her environment, memory, vault and agent, made the first time and kept in D1. A new MCP token
 * replaces the vault's; a new definition becomes a new agent version.
 */
export const ensureSetup = async (
  client: Anthropic,
  db: D1Database,
  site: string,
  token: string,
): Promise<Mia2Setup> => {
  const rows = await db
    .prepare("SELECT key, value FROM mia2_setup")
    .all<{ key: string; value: string }>();
  const have = new Map(rows.results.map((r) => [r.key, r.value]));
  const save = async (key: string, value: string) => {
    have.set(key, value);
    await db
      .prepare(
        "INSERT INTO mia2_setup (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .bind(key, value)
      .run();
  };

  if (!have.has("environment")) {
    const env = await client.beta.environments.create({
      name: "neko-mia",
      // Her sandbox reaches the Neko's tools and nothing else.
      config: { type: "cloud", networking: { type: "limited", allow_mcp_servers: true } },
    });
    await save("environment", env.id);
  }
  if (!have.has("memory_store")) {
    const store = await client.beta.memoryStores.create({
      name: "mia",
      description:
        "Memória da Mia sobre o dono do Neko: contexto pessoal, preferências e combinados. Sem valores que mudam e sem senhas.",
    });
    await save("memory_store", store.id);
  }
  if (!have.has("vault")) {
    const vault = await client.beta.vaults.create({ display_name: "Neko" });
    await save("vault", vault.id);
  }
  const vault = have.get("vault") ?? "";
  const tokenHash = await sha256(token);
  if (have.get("vault_token") !== tokenHash) {
    const credential = have.get("vault_credential");
    if (credential) {
      await client.beta.vaults.credentials.update(credential, {
        vault_id: vault,
        auth: { type: "static_bearer", token },
      });
    } else {
      const created = await client.beta.vaults.credentials.create(vault, {
        display_name: "Neko MCP",
        auth: { type: "static_bearer", mcp_server_url: `${site}/api/mcp`, token },
      });
      await save("vault_credential", created.id);
    }
    await save("vault_token", tokenHash);
  }

  const config = agentConfig(site);
  const hash = await sha256(JSON.stringify(config));
  if (!have.has("agent")) {
    const agent = await client.beta.agents.create(config);
    await save("agent", agent.id);
    await save("agent_version", String(agent.version));
    await save("agent_hash", hash);
  } else if (have.get("agent_hash") !== hash) {
    const agent = await client.beta.agents.update(have.get("agent") ?? "", {
      ...config,
      version: Number(have.get("agent_version")),
    });
    await save("agent_version", String(agent.version));
    await save("agent_hash", hash);
  }

  return {
    environment: have.get("environment") ?? "",
    memoryStore: have.get("memory_store") ?? "",
    vault,
    agent: have.get("agent") ?? "",
    version: Number(have.get("agent_version")),
  };
};

/** What the wait line says while she uses a tool. */
const STATUS: Record<string, string> = {
  hoje: "Lendo o dia de hoje…",
  periodo: "Lendo o período…",
  mes: "Lendo o mês…",
  comparar_meses: "Comparando os meses…",
  gasto_com: "Procurando os gastos…",
  resumo_meses: "Lendo os meses…",
  dias_do_mes: "Lendo os dias do mês…",
  faturas: "Lendo as faturas…",
  reserva: "Lendo a reserva…",
  semana: "Lendo a semana…",
  simular: "Simulando…",
  para_lancar: "Lendo o Para lançar…",
  propor_lancamento: "Deixando em Para lançar…",
  bash: "Fazendo as contas…",
  read: "Lendo a memória…",
  glob: "Lendo a memória…",
  grep: "Lendo a memória…",
  write: "Anotando na memória…",
  edit: "Anotando na memória…",
};

type Blocks = readonly { type: string; text?: string }[] | null | undefined;
const textOf = (content: Blocks) =>
  (content ?? [])
    .map((b) => (b.type === "text" ? (b.text ?? "") : ""))
    .join("\n")
    .trim();

const valuesOf = (checked: ReturnType<typeof checkText>) =>
  Object.fromEntries(checked.map(({ texto, ...v }) => [texto, v satisfies Mia2Valor])) as Record<
    string,
    Mia2Valor
  >;

export interface TurnDeps {
  readonly client: Anthropic;
  readonly db: D1Database;
  readonly today: LocalDate;
  readonly now: () => Date;
  /** Spent this month, Mia 1 and 2 together, in micro-dollars. */
  readonly spentMicroUsd: number;
  /** One NDJSON line to the phone; it may have left, which never stops the turn. */
  readonly write: (line: Mia2Line) => void;
  readonly turnMs?: number;
}

const known = async (db: D1Database, id: string) =>
  (await db.prepare("SELECT 1 AS ok FROM mia2_session WHERE id = ?").bind(id).first()) !== null;

/**
 * One question: in the conversation asked for (when it is one of hers), or in a new one. Ends with
 * `fim` or `erro`; what the conversation cost is booked either way.
 */
export const runTurn = async (
  deps: TurnDeps,
  setup: Mia2Setup,
  ask: { pergunta: string; sessao?: string | undefined },
): Promise<void> => {
  const { client, db, write } = deps;
  let session = ask.sessao && (await known(db, ask.sessao)) ? ask.sessao : undefined;
  if (!session) {
    const left = Math.floor((CAP_MICRO_USD - deps.spentMicroUsd) / 10_000);
    const cap = Math.min(SESSION_CAP_CENTS, left);
    if (cap < 1) {
      write({ t: "erro", motivo: "limite_mes" });
      return;
    }
    write({ t: "status", texto: "Abrindo a conversa…" });
    const created = await client.beta.sessions.create({
      agent: { type: "agent", id: setup.agent, version: setup.version },
      environment_id: setup.environment,
      vault_ids: [setup.vault],
      resources: [
        {
          type: "memory_store",
          memory_store_id: setup.memoryStore,
          access: "read_write",
          instructions: MEMORY_NOTE,
        },
      ],
      budget: { type: "limit", max_list_cost: { amount: String(cap), currency: "USD" } },
      title: "Mia",
      metadata: { app: "neko" },
    });
    session = created.id;
    const at = deps.now().toISOString();
    await db
      .prepare("INSERT INTO mia2_session (id, started_at, last_at, cost_cents) VALUES (?, ?, ?, 0)")
      .bind(session, at, at)
      .run();
  }
  const id = session;
  write({ t: "sessao", id });
  try {
    await relay(deps, id, ask.pergunta);
  } finally {
    await bookCost(deps, id).catch((e) => console.error("mia2 cost", e));
  }
};

/**
 * Her charts wait for her first words: she draws before she writes, but the answer leads and the
 * chart comes under it. A chart she drew and never wrote about still comes at the end.
 */
const chartsAfterText = (write: TurnDeps["write"]): TurnDeps["write"] => {
  let texted = false;
  const held: Mia2Line[] = [];
  return (l) => {
    if ((l.t === "grafico" || l.t === "numeros") && !texted) {
      held.push(l);
      return;
    }
    if (l.t === "refazendo") {
      texted = false;
      held.length = 0;
    }
    if (l.t === "fim" || l.t === "erro") for (const h of held.splice(0)) write(h);
    write(l);
    if ((l.t === "parcial" || l.t === "mensagem") && !texted) {
      texted = true;
      for (const h of held.splice(0)) write(h);
    }
  };
};

/** Streams one turn of conversation `id`, answering her chart calls and checking her numbers. */
const relay = async (deps: TurnDeps, id: string, pergunta: string) => {
  const { client } = deps;
  const write = chartsAfterText(deps.write);
  const seen: Seen = new Map();
  seeText(seen, pergunta);
  const uses = new Map<string, { name: string; input: unknown }>();
  let history = false;
  // Numbers of earlier questions in this conversation, read only when a value needs them.
  const withHistory = async () => {
    if (history) return;
    history = true;
    const old = new Map<string, { name: string; input: unknown }>();
    for await (const ev of client.beta.sessions.events.list(id)) {
      if (ev.type === "user.message") seeText(seen, textOf(ev.content));
      else if (ev.type === "agent.mcp_tool_use") old.set(ev.id, { name: ev.name, input: ev.input });
      else if (ev.type === "agent.mcp_tool_result" && !ev.is_error) {
        const use = old.get(ev.mcp_tool_use_id);
        seeToolResult(seen, use?.name ?? "", use?.input, textOf(ev.content));
      } else if (ev.type === "agent.tool_result" && !ev.is_error) seeText(seen, textOf(ev.content));
    }
  };
  const check = async (text: string) => {
    let checked = checkText(seen, text);
    if (checked.some((v) => !v.conferido)) {
      await withHistory();
      checked = checkText(seen, text);
    }
    return checked;
  };

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), deps.turnMs ?? TURN_MS);
  const stream = await client.beta.sessions.events.stream(
    id,
    { event_deltas: ["agent.message"] },
    { signal: abort.signal },
  );
  const previews = new Map<string, string>();
  let unchecked: string[] = [];
  let corrected = false;
  // The owner pressed Stop: what she said so far stays, and nothing is redone.
  let stopped = false;
  let ended = false;
  try {
    await send(client, id, [{ type: "user.message", content: [{ type: "text", text: pergunta }] }]);
    for await (const ev of stream as AsyncIterable<StreamEvent>) {
      if (ev.type === "event_start") {
        if (ev.event.type === "agent.message") previews.set(ev.event.id, "");
      } else if (ev.type === "event_delta") {
        const text = (previews.get(ev.event_id) ?? "") + (ev.delta.content?.text ?? "");
        previews.set(ev.event_id, text);
        write({ t: "parcial", id: ev.event_id, texto: text });
      } else if (ev.type === "user.interrupt") {
        stopped = true;
      } else if (ev.type === "agent.thinking") {
        write({ t: "status", texto: "Pensando…" });
      } else if (ev.type === "agent.mcp_tool_use") {
        uses.set(ev.id, { name: ev.name, input: ev.input });
        write({ t: "status", texto: STATUS[ev.name] ?? "Lendo o Neko…" });
      } else if (ev.type === "agent.mcp_tool_result") {
        const use = uses.get(ev.mcp_tool_use_id);
        if (!ev.is_error) seeToolResult(seen, use?.name ?? "", use?.input, textOf(ev.content));
      } else if (ev.type === "agent.tool_use") {
        const status = STATUS[ev.name];
        if (status) write({ t: "status", texto: status });
      } else if (ev.type === "agent.tool_result") {
        if (!ev.is_error) seeText(seen, textOf(ev.content));
      } else if (ev.type === "agent.message") {
        previews.delete(ev.id);
        const texto = textOf(ev.content);
        if (!texto) continue;
        const checked = await check(texto);
        unchecked.push(...checked.filter((v) => !v.conferido).map((v) => v.texto));
        write({ t: "mensagem", id: ev.id, texto, valores: valuesOf(checked) });
      } else if (ev.type === "agent.custom_tool_use") {
        await chart({ ...deps, write }, id, ev, seen, withHistory);
      } else if (ev.type === "session.status_idle") {
        const why = ev.stop_reason.type;
        if (why === "requires_action") continue;
        if (why === "budget_reached") {
          write({ t: "erro", motivo: "limite_conversa" });
          ended = true;
          break;
        }
        if (why === "end_turn" && unchecked.length > 0 && !corrected && !stopped) {
          // One more try: she is told which values had no source, and the owner sees the new answer.
          corrected = true;
          const missing = [...new Set(unchecked)].join(", ");
          unchecked = [];
          write({ t: "refazendo" });
          write({ t: "status", texto: "Um número não bateu. Refazendo a conta…" });
          // A system message rides right after the user message it goes with, never before.
          await send(client, id, [
            {
              type: "user.message",
              content: [{ type: "text", text: "Pode conferir os números da última resposta?" }],
            },
            {
              type: "system.message",
              content: [
                {
                  type: "text",
                  text: `Conferência do Neko: na última resposta, ${missing} não saiu de nenhuma ferramenta nem de conta feita no bash. Responda de novo à mesma pergunta usando só números das ferramentas do Neko ou de contas no bash, sem mencionar esta conferência.`,
                },
              ],
            },
          ]);
          continue;
        }
        write(why === "end_turn" ? { t: "fim" } : { t: "erro", motivo: "falha" });
        ended = true;
        break;
      } else if (ev.type === "session.status_terminated") {
        write({ t: "erro", motivo: "falha" });
        ended = true;
        break;
      } else if (ev.type === "session.error") {
        console.error("mia2 session error", JSON.stringify(ev));
      }
    }
    // The stream closed (or the clock ran out) before she was done: she is stopped, not left running.
    if (!ended) {
      write({ t: "erro", motivo: "falha" });
      if (abort.signal.aborted)
        await send(client, id, [{ type: "user.interrupt" }]).catch(() => undefined);
    }
  } finally {
    clearTimeout(timer);
    abort.abort();
  }
};

/** The owner's Stop on one of her conversations: she is interrupted where she is. */
export const stopTurn = async (client: Anthropic, db: D1Database, id: string) => {
  if (!(await known(db, id))) return false;
  await client.beta.sessions.events.send(id, { events: [{ type: "user.interrupt" }] });
  return true;
};

type Outgoing = Parameters<Anthropic["beta"]["sessions"]["events"]["send"]>[1]["events"];

/**
 * Sends events; a new question refused because an earlier chart call was left unanswered (the phone
 * went away mid-answer) settles those calls first and goes again.
 */
const send = async (client: Anthropic, id: string, events: Outgoing) => {
  try {
    await client.beta.sessions.events.send(id, { events });
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status !== 400 || !events.some((ev) => ev.type === "user.message")) throw e;
    const asked = new Set<string>();
    for await (const ev of client.beta.sessions.events.list(id)) {
      if (ev.type === "agent.custom_tool_use") asked.add(ev.id);
      else if (ev.type === "user.custom_tool_result") asked.delete(ev.custom_tool_use_id);
    }
    if (asked.size === 0) throw e;
    await client.beta.sessions.events.send(id, {
      events: [...asked].map((use) => ({
        type: "user.custom_tool_result" as const,
        custom_tool_use_id: use,
        content: [{ type: "text" as const, text: "A conversa foi interrompida antes do gráfico." }],
        is_error: true,
      })),
    });
    await client.beta.sessions.events.send(id, { events });
  }
};

/** What in a chart or a board did not come from the tools: its numbers, and any R$ in its words. */
const looseOf = (seen: Seen, values: readonly number[], words: readonly string[]) => [
  ...values.filter((v) => !seenValue(seen, v)).map(String),
  ...checkText(seen, words.join("\n")).flatMap((c) => (c.conferido ? [] : [c.texto])),
];

/** Her chart call: drawn when every value checks, refused with the reason otherwise. */
const chart = async (
  deps: TurnDeps,
  id: string,
  ev: Extract<StreamEvent, { type: "agent.custom_tool_use" }>,
  seen: Seen,
  withHistory: () => Promise<void>,
) => {
  const reply = (text: string, isError: boolean) =>
    send(deps.client, id, [
      {
        type: "user.custom_tool_result",
        custom_tool_use_id: ev.id,
        content: [{ type: "text", text }],
        is_error: isError,
      },
    ]);
  if (ev.name === NUMBERS_TOOL) return board(deps, ev, seen, withHistory, reply);
  if (ev.name !== CHART_TOOL) return reply(`Ferramenta desconhecida: ${ev.name}.`, true);
  const parsed = Chart.safeParse(ev.input);
  if (!parsed.success) return reply(`Gráfico inválido: ${parsed.error.issues[0]?.message}.`, true);
  const values = parsed.data.series.flatMap((s) => s.valores);
  const words = [parsed.data.titulo, parsed.data.nota ?? ""];
  let loose = looseOf(seen, values, words);
  if (loose.length > 0) {
    await withHistory();
    loose = looseOf(seen, values, words);
  }
  if (loose.length > 0)
    return reply(
      `Estes valores não vieram das ferramentas nem do bash: ${loose.slice(0, 5).join(", ")}. Use os números das ferramentas.`,
      true,
    );
  const grafico: Mia2Grafico = parsed.data;
  deps.write({ t: "grafico", id: ev.id, grafico });
  return reply("Gráfico mostrado ao dono.", false);
};

/** Her board of numbers: shown when every value checks, each leading to where it was read. */
const board = async (
  deps: TurnDeps,
  ev: Extract<StreamEvent, { type: "agent.custom_tool_use" }>,
  seen: Seen,
  withHistory: () => Promise<void>,
  reply: (text: string, isError: boolean) => Promise<unknown>,
) => {
  const parsed = Numbers.safeParse(ev.input);
  if (!parsed.success) return reply(`Números inválidos: ${parsed.error.issues[0]?.message}.`, true);
  const { itens } = parsed.data;
  const values = itens.map((i) => i.valor);
  const words = itens.flatMap((i) => [i.rotulo, i.nota ?? ""]);
  let loose = looseOf(seen, values, words);
  if (loose.length > 0) {
    await withHistory();
    loose = looseOf(seen, values, words);
  }
  if (loose.length > 0)
    return reply(
      `Estes valores não vieram das ferramentas nem do bash: ${loose.join(", ")}. Use os números das ferramentas.`,
      true,
    );
  const numeros: Mia2Numero[] = itens.map((i) => ({ ...i, ...(sourceOf(seen, i.valor) ?? {}) }));
  deps.write({ t: "numeros", id: ev.id, numeros });
  return reply("Números mostrados ao dono.", false);
};

/** Books what the conversation cost since it was last booked, against the month's cap. */
const bookCost = async (deps: TurnDeps, id: string) => {
  const session = await deps.client.beta.sessions.retrieve(id);
  const total = Number(session.usage.list_cost?.amount ?? 0);
  const row = await deps.db
    .prepare("SELECT cost_cents FROM mia2_session WHERE id = ?")
    .bind(id)
    .first<{ cost_cents: number }>();
  const delta = total - Number(row?.cost_cents ?? 0);
  const at = deps.now().toISOString();
  const statements = [
    deps.db
      .prepare("UPDATE mia2_session SET cost_cents = ?, last_at = ? WHERE id = ?")
      .bind(total, at, id),
  ];
  if (delta > 0)
    statements.push(
      deps.db
        .prepare(
          `INSERT INTO mia_usage (at, month, model, input_tokens, output_tokens, cache_write_tokens,
           cache_read_tokens, micro_usd) VALUES (?, ?, ?, 0, 0, 0, 0, ?)`,
        )
        .bind(at, ledgerMonth(deps.today), `mia2:${MIA2_MODEL}`, delta * 10_000),
    );
  await deps.db.batch(statements);
};
