import { type CallToolResult, createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import {
  type Cents,
  type Change,
  cents,
  checkPurchase,
  type EntryInput,
  entryFromMia,
  localDate,
  MAX_CHANGES,
  MAX_INSTALLMENTS,
  MAX_REPEAT,
  MIA_PERIODS,
  type MonthView,
  type PurchaseReason,
  refBook,
  runMiaTool,
  type ScenarioPoint,
} from "@neko/engine";
import { z } from "zod";
import { scenarioInput, scenarioView } from "../shared/screens.ts";
import type { ProjectionResponse } from "../shared/types.ts";

/**
 * Mia 2's window on Neko: the sheet, the bills, the reserve, Para lançar and Simular as MCP tools,
 * for the agent that holds the token (Model Context Protocol, both the 2026-07-28 stateless era
 * and the 2025 one). Nothing here writes to the sheet: all tools read, except propor_lancamento,
 * which leaves an entry in Para lançar for the owner to launch or ignore. Unlike Mia 1's tools,
 * values go out in reais, so the agent can chart and reason over them; every number it shows must
 * still come from a tool.
 */

/** What every tool reads: the projection and the ceiling of Ajustes. */
export interface McpData {
  readonly data: ProjectionResponse;
  readonly ceiling: Cents | null;
}

const reais = (c: number) => c / 100;

/** Mia 1's references (`{ref, cents}` and `{ref, pct}`) back to plain values in reais and percent. */
const plain = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v !== "object" || v === null) return v;
  const o = v as Record<string, unknown>;
  if (typeof o.ref === "string" && typeof o.cents === "number") return reais(o.cents);
  if (typeof o.ref === "string" && typeof o.pct === "number") return o.pct;
  return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, plain(x)]));
};

const answer = (out: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(out) }],
});
const refuse = (text: string): CallToolResult => ({
  content: [{ type: "text", text }],
  isError: true,
});

/** A Mia 1 tool, same checks and words, with real values. */
const engineTool = (d: McpData, name: string, input: unknown): CallToolResult => {
  const out = runMiaTool(d.data.projection, name, input, refBook());
  return typeof out.erro === "string" ? refuse(out.erro) : answer(plain(out));
};

const keyOf = (m: MonthView) => `${m.year}-${String(m.month).padStart(2, "0")}`;
const Month = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .describe("Mês no formato AAAA-MM.");
const situation = (today: string, key: string) =>
  key < today.slice(0, 7) ? "fechado" : key === today.slice(0, 7) ? "em andamento" : "futuro";
/** resumo_meses reads at most three years at once. */
const MAX_SUMMARY = 36;

const MOVE = { income: "entrada", bill: "conta", card: "cartao", diario: "diario" } as const;

const Reais = z.number().positive().max(100_000_000);
const Day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("Dia no formato AAAA-MM-DD.");
const SimulateInput = z.object({
  ritmo: z
    .enum(["planilha", "teto", "media"])
    .optional()
    .describe(
      "Como os meses à frente gastam: planilha (só o que já está lançado), teto (o Teto do mês de Ajustes, cartões e Pix) ou media (média dos últimos 3 meses inteiros). Sem ritmo: o teto quando existe, senão a planilha.",
    ),
  mudancas: z
    .array(
      z.discriminatedUnion("tipo", [
        z.object({
          tipo: z.literal("compra").describe("Compra hoje no cartão de sempre."),
          valor: Reais.describe("Valor total em reais."),
          parcelas: z.number().int().min(1).max(MAX_INSTALLMENTS),
        }),
        z.object({
          tipo: z.enum(["entrada", "saida"]),
          valor: Reais.describe("Valor de cada vez, em reais."),
          data: Day,
          meses: z
            .number()
            .int()
            .min(1)
            .max(MAX_REPEAT)
            .describe("Quantos meses repete, 1 = uma vez."),
        }),
      ]),
    )
    .max(MAX_CHANGES)
    .default([]),
});

const toChange = (m: z.infer<typeof SimulateInput>["mudancas"][number]): Change =>
  m.tipo === "compra"
    ? { kind: "compra", amount: cents(Math.round(m.valor * 100)), count: m.parcelas }
    : {
        kind: m.tipo,
        amount: cents(Math.round(m.valor * 100)),
        date: localDate(m.data),
        months: m.meses,
      };

/** An entry the owner asked Mia to launch, in Mia 1's words (engine `entryFromMia`). */
const ProposeInput = z.object({
  tipo: z
    .enum(["pix", "entrada", "conta", "cartao"])
    .describe(
      "pix: gasto do dia a dia no Pix ou no débito (vai para o Diário). entrada: dinheiro que entrou. conta: conta paga, como luz ou aluguel. cartao: compra num cartão.",
    ),
  valor: Reais.describe("Valor em reais; numa compra parcelada, o total."),
  nome: z.string().trim().min(1).max(80).describe("Nome curto, como o dono escreve na planilha."),
  dia: Day.optional().describe("Dia do gasto ou da compra. Sem dia: hoje."),
  cartao: z
    .string()
    .max(60)
    .optional()
    .describe("Só em cartao: o nome do cartão, como a ferramenta faturas mostra."),
  parcelas: z.number().int().min(1).max(MAX_INSTALLMENTS).optional().describe("Só em cartao."),
});

/** Leaves one entry in Para lançar; the owner launches or ignores it there. */
export type Propose = (entry: EntryInput) => Promise<void>;

const proposeTool = async (
  d: McpData,
  input: z.infer<typeof ProposeInput>,
  propose: Propose,
): Promise<CallToolResult> => {
  const today = d.data.projection.today;
  // The cards Lançar à mão offers: the ones whose closing day is known.
  const cards = d.data.cardsKnown.filter((c) => !c.closingEstimated).map((c) => c.name);
  const e = entryFromMia({ ...input, dia: input.dia ?? today }, today, cards);
  if (!e?.kind)
    return refuse(
      cards.length > 0
        ? `Não conheço esse cartão. Os cartões: ${cards.join(", ")}.`
        : "Não há cartão com fechamento conhecido para lançar.",
    );
  if (e.amount === undefined || e.date === undefined || e.description === undefined)
    return refuse("Falta o valor, o dia ou o nome, ou o dia está longe demais de hoje.");
  const month = e.date.slice(0, 7);
  if (!d.data.projection.months.some((m) => keyOf(m) === month))
    return refuse(`A planilha não tem o mês ${month}.`);
  const entry: EntryInput = {
    kind: e.kind,
    amount: e.amount,
    date: e.date,
    description: e.description,
    ...(e.card ? { card: e.card } : {}),
    ...(e.installments ? { installments: e.installments } : {}),
  };
  await propose(entry);
  return answer({
    em_para_lancar: true,
    lancamento: {
      tipo: input.tipo,
      valor: reais(entry.amount),
      dia: entry.date,
      nome: entry.description,
      ...(entry.card ? { cartao: entry.card, parcelas: entry.installments ?? 1 } : {}),
    },
    planilha: "Ainda não mudou: muda quando o dono tocar em Lançar.",
  });
};

const point = (p: { date: string; balance: number } | null) =>
  p && { data: p.date, saldo: reais(p.balance) };

const simulateTool = (d: McpData, input: z.infer<typeof SimulateInput>): CallToolResult => {
  try {
    const v = scenarioView(d.data, d.ceiling, {
      pace: input.ritmo,
      changes: input.mudancas.map(toChange),
    });
    return answer({
      hoje: v.today,
      planilha_lida_em: v.readAt,
      ultimo_dia_da_planilha: v.end,
      ritmo: v.pace,
      ritmos_possiveis: v.paces,
      gasto_por_mes_no_teto: v.spends.teto === null ? null : reais(v.spends.teto),
      gasto_por_mes_na_media: v.spends.media === null ? null : reais(v.spends.media),
      ritmo_conta_a_partir_de: v.paceFrom,
      menor_saldo: point(v.lowest),
      primeiro_dia_negativo: point(v.firstNegative),
      primeiro_dia_negativo_so_com_a_planilha: point(v.sheetFirstNegative),
      melhor_caso_nos_meses: v.full,
      dia_de_guardar: v.saving && {
        dia: v.saving.date,
        entrada: reais(v.saving.income),
        da_para_guardar: reais(v.saving.amount),
        menor_saldo_depois: reais(v.saving.leftAtLowest),
      },
      efeito_das_mudancas: v.effect && {
        no_menor_saldo: reais(v.effect.lowest),
        no_fim: reais(v.effect.end),
      },
      cada_mudanca: v.effects.map((e) => ({
        no_menor_saldo: reais(e.lowest),
        no_fim: reais(e.end),
        parcelas_dentro_do_ritmo: e.inPace && {
          quantas: e.inPace.count,
          por_mes: reais(e.inPace.perMonth),
          ate: e.inPace.until,
        },
        datas_dentro_da_planilha: e.counted,
        datas_pedidas: e.of,
      })),
      mudancas_recusadas: v.refused,
      fim_de_cada_mes: v.months.map((m) => ({
        mes: `${m.year}-${String(m.month).padStart(2, "0")}`,
        planilha: reais(m.endSheet),
        simulacao: reais(m.endSim),
      })),
    });
  } catch (e) {
    if (e instanceof RangeError) return refuse(`Não dá para simular: ${e.message}`);
    throw e;
  }
};

const PurchaseInput = z.object({
  valor: Reais.describe("Valor total da compra, em reais."),
  parcelas: z
    .number()
    .int()
    .min(1)
    .max(MAX_INSTALLMENTS)
    .default(1)
    .describe("No cartão, em quantas vezes. No Pix, 1."),
  meio: z
    .enum(["cartao", "pix"])
    .default("cartao")
    .describe(
      "cartao: no cartão principal, a primeira parcela na próxima fatura. pix: hoje, de uma vez, no Pix ou no débito.",
    ),
});

/** What Hoje's "Ainda cabem" measures this month. */
const MEASURE = {
  cards: "teto do mês (faturas do mês que vem e Pix deste mês)",
  month: "diário previsto do mês",
  cycle: "ciclo do cartão principal",
} as const;

const REASON: Record<PurchaseReason, string> = {
  teto: "passa do que ainda cabe neste mês",
  negativo: "deixa o saldo negativo, ou negativo mais cedo",
  meses: "num mês das parcelas, as faturas com a parcela chegam ao teto",
  ja_negativo: "o saldo já fica negativo sem a compra, e ela piora",
};

const purchaseTool = (d: McpData, input: z.infer<typeof PurchaseInput>): CallToolResult => {
  const { projection: p, sheet } = d.data;
  if (input.meio === "pix" && input.parcelas !== 1)
    return refuse("Pix é de uma vez: use parcelas 1.");
  const usual = p.cards.find((c) => c.usual)?.card.name ?? null;
  if (input.meio === "cartao" && usual === null)
    return refuse("Não há cartão principal para pôr a compra. Pergunte se vai no Pix.");
  try {
    const c = checkPurchase(scenarioInput(d.data, d.ceiling), {
      amount: cents(Math.round(input.valor * 100)),
      count: input.parcelas,
      via: input.meio,
    });
    const cs = p.canSpend;
    const first = c.parcels[0];
    const last = c.parcels.at(-1);
    const pair = (x: { with: ScenarioPoint | null; without: ScenarioPoint | null }) => ({
      sem_a_compra: point(x.without),
      com_a_compra: point(x.with),
    });
    const saving = c.saving.without ?? c.saving.with;
    return answer({
      hoje: p.today,
      planilha_lida_em: sheet.readAt,
      veredito: c.verdict,
      motivos: c.reasons.map((r) => REASON[r]),
      compra: {
        valor: input.valor,
        meio: input.meio,
        cartao: input.meio === "cartao" ? usual : null,
        parcelas: c.parcels.length,
        valor_da_parcela: first ? reais(first.amount) : null,
        primeira: first?.date ?? null,
        ultima: last?.date ?? null,
      },
      ainda_cabem:
        cs && c.now
          ? {
              medido_por: MEASURE[cs.mode],
              limite: reais(cs.budget),
              gasto_ate_agora: reais(cs.accumulated),
              antes: reais(cs.budget - cs.accumulated),
              depois: reais(c.now.remaining),
            }
          : null,
      ritmo: c.pace,
      teto_por_mes: d.ceiling === null ? null : reais(d.ceiling),
      meses_sem_folga: c.tight.map((t) => ({
        mes: t.month,
        faturas_com_a_parcela: reais(t.bills),
      })),
      menor_saldo: pair(c.lowest),
      primeiro_dia_negativo: pair(c.firstNegative),
      dia_de_guardar: saving && {
        dia: saving.date,
        sem_a_compra: c.saving.without ? reais(c.saving.without.amount) : null,
        com_a_compra: c.saving.with ? reais(c.saving.with.amount) : null,
      },
    });
  } catch (e) {
    if (e instanceof RangeError) return refuse(`Não dá para conferir: ${e.message}`);
    throw e;
  }
};

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

/**
 * One server with every tool, over the data `load` reads once, on the first call that needs it.
 * Without `propose`, propor_lancamento is left out and every tool only reads.
 */
export const nekoServer = (load: () => Promise<McpData>, propose?: Propose): McpServer => {
  let cached: Promise<McpData> | null = null;
  const data = () => {
    cached ??= load();
    return cached;
  };
  const server = new McpServer(
    { name: "neko", version: "1.0.0" },
    {
      instructions:
        "Neko lê a planilha de finanças do dono (método da Escola do Breno) e responde em reais. Nada aqui muda a planilha: propor_lancamento só deixa um lançamento em Para lançar, e ele entra na planilha quando o dono toca em Lançar. Os meses futuros têm só o que já está lançado; para ver um futuro com gasto do dia a dia, use simular.",
    },
  );
  const engine = (name: string, title: string, description: string, input?: z.ZodObject) =>
    server.registerTool(
      name,
      { title, description, inputSchema: input ?? z.object({}), annotations: READ_ONLY },
      async (args) => engineTool(await data(), name, args),
    );

  engine(
    "periodo",
    "Período",
    "Converte um período em palavras (este mês, mês passado...) nos meses AAAA-MM de início e fim, a partir de hoje.",
    z.object({ expressao: z.enum(MIA_PERIODS) }),
  );
  engine(
    "hoje",
    "Hoje",
    "Saldo de hoje, quanto ainda cabe (no teto do mês com cartões e Pix, no Diário previsto ou no ciclo do cartão principal), o diário previsto por dia e o que vence nos próximos 7 dias.",
  );
  engine(
    "mes",
    "Um mês",
    "Um mês da planilha: entradas, saídas, diário, resultado (saldo final menos o inicial), guardado e a parte das entradas, custo de vida, diário médio por dia, saldos e as maiores saídas por nome.",
    z.object({ mes: Month }),
  );
  engine(
    "comparar_meses",
    "Comparar meses",
    "Compara dois meses: cada número dos dois, a diferença (b menos a), a direção e a variação em percentual.",
    z.object({
      a: Month.describe("Mês anterior, AAAA-MM."),
      b: Month.describe("Mês posterior, AAAA-MM."),
    }),
  );
  engine(
    "gasto_com",
    "Gasto com um nome",
    "Quanto saiu com um nome (mercado, aluguel, um cartão) entre dois meses, mês a mês e no total. Procura nas saídas; o diário não tem nomes.",
    z.object({
      termo: z.string().min(2).max(60),
      de: Month.describe("Primeiro mês, AAAA-MM."),
      ate: Month.describe("Último mês, AAAA-MM."),
    }),
  );
  engine(
    "faturas",
    "Faturas",
    "Cada cartão: a fatura aberta na planilha, o fechamento, o vencimento, se é o principal e se é de outra pessoa.",
  );
  engine(
    "reserva",
    "Reserva de emergência",
    "Quanto está guardado, o próximo degrau (como o Mês mostra) e quanto falta para ele, o custo de vida médio, as metas do método (6 e 12 meses) e quantos meses de custo o guardado cobre.",
  );

  server.registerTool(
    "semana",
    {
      title: "Semana passada",
      description:
        "A última semana inteira, de domingo a sábado: o que cartões e Pix levaram, como o banco mostra e sem as compras de outras pessoas, a semana anterior para comparar e quantos dias foram lançados na planilha.",
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    async () => {
      const { week, habit } = (await data()).data;
      if (!week) return refuse("O banco não cobre a semana passada inteira.");
      return answer({
        de: week.from,
        ate: week.to,
        cartoes_e_pix: reais(week.total),
        semana_anterior: week.previous === null ? null : reais(week.previous),
        diferenca: week.previous === null ? null : reais(week.total - week.previous),
        dias_lancados: habit?.lastWeek ?? null,
      });
    },
  );

  server.registerTool(
    "resumo_meses",
    {
      title: "Resumo de vários meses",
      description:
        "Os números de cada mês entre dois meses, para comparar e desenhar gráficos: entradas, saídas, diário, resultado, guardado, custo de vida e saldo no fim. Até 36 meses.",
      inputSchema: z.object({
        de: Month.describe("Primeiro mês, AAAA-MM."),
        ate: Month.describe("Último mês, AAAA-MM."),
      }),
      annotations: READ_ONLY,
    },
    async ({ de, ate }) => {
      if (de > ate) return refuse("O primeiro mês vem depois do último.");
      const { projection: p } = (await data()).data;
      const months = p.months.filter((m) => keyOf(m) >= de && keyOf(m) <= ate);
      if (months.length === 0) return refuse("A planilha não tem esses meses.");
      return answer({
        meses: months.slice(0, MAX_SUMMARY).map((m) => ({
          mes: keyOf(m),
          situacao: situation(p.today, keyOf(m)),
          entradas: reais(m.entrada),
          saidas: reais(m.saida),
          diario: reais(m.diario),
          resultado: reais(m.result),
          guardado: reais(m.saved),
          custo_de_vida: reais(m.livingCost),
          saldo_no_fim: reais(m.endSheet),
        })),
        cortado_em_36_meses: months.length > MAX_SUMMARY,
      });
    },
  );

  server.registerTool(
    "dias_do_mes",
    {
      title: "Dias de um mês",
      description:
        "Cada dia de um mês como a planilha tem: o saldo no fim do dia, se é futuro e o que mexeu nele (entradas, contas, cartões e o diário, com o nome e o valor).",
      inputSchema: z.object({ mes: Month }),
      annotations: READ_ONLY,
    },
    async ({ mes }) => {
      const m = (await data()).data.projection.months.find((x) => keyOf(x) === mes);
      if (!m) return refuse("A planilha não tem esse mês.");
      return answer({
        mes,
        dias: m.days.map((day) => ({
          data: `${mes}-${String(day.day).padStart(2, "0")}`,
          saldo: reais(day.balance),
          futuro: day.future,
          movimentos: day.moves.map((x) => ({
            tipo: MOVE[x.kind],
            nome: x.description,
            valor: reais(x.amount),
          })),
        })),
      });
    },
  );

  server.registerTool(
    "simular",
    {
      title: "Simular o futuro",
      description:
        "Os saldos da planilha daqui até o último mês num ritmo de gasto e com mudanças hipotéticas (compra parcelada, entrada ou saída repetida). É a tela Simular: nada é salvo e a planilha não muda. Devolve o menor saldo, o primeiro dia negativo, quanto dá para guardar no dia do salário e o saldo no fim de cada mês, na planilha e na simulação.",
      inputSchema: SimulateInput,
      annotations: READ_ONLY,
    },
    async (input) => simulateTool(await data(), input),
  );

  server.registerTool(
    "posso_comprar",
    {
      title: "Posso comprar?",
      description:
        "Confere uma compra contra as regras do dono: o que ainda cabe neste mês (como o Hoje mostra), as faturas dos meses das parcelas contra o teto e se o saldo fica negativo, com os meses à frente no teto. Devolve o veredito (cabe, aperta ou nao_cabe), os motivos, a parcela, o que ainda cabe antes e depois, o menor saldo e o dia de guardar, com e sem a compra. Nada é salvo.",
      inputSchema: PurchaseInput,
      annotations: READ_ONLY,
    },
    async (input) => purchaseTool(await data(), input),
  );

  server.registerTool(
    "para_lancar",
    {
      title: "Para lançar",
      description:
        "O que o banco mostrou e a planilha ainda não tem: cada item com dia, tipo, nome, o que o banco viu e as opções de lançamento. Só mostra; quem lança é o dono, no app.",
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    async () => {
      const bank = (await data()).data.bank;
      if (!bank) return answer({ banco_ligado: false, itens: [] });
      return answer({
        banco_ligado: true,
        banco_lido_em: bank.syncedAt,
        itens: (bank.queue ?? []).map((i) => ({
          data: i.date,
          tipo: i.kind,
          nome: i.title,
          no_banco: i.bank.map((b) => ({
            data: b.date,
            valor: reais(b.amount),
            descricao: b.description,
          })),
          opcoes: i.options.map((o) => o.label).filter(Boolean),
        })),
      });
    },
  );

  if (propose)
    server.registerTool(
      "propor_lancamento",
      {
        title: "Propor um lançamento",
        description:
          "Deixa um lançamento em Para lançar, quando o dono pede para lançar algo que contou: um gasto no Pix, uma entrada, uma conta paga ou uma compra no cartão. A planilha não muda: o dono confere e toca em Lançar, ou ignora. Um lançamento por chamada.",
        inputSchema: ProposeInput,
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      async (input) => proposeTool(await data(), input, propose),
    );

  return server;
};

/** One MCP request, answered by a fresh server (the transport keeps nothing between requests). */
export const serveMcp = (
  request: Request,
  load: () => Promise<McpData>,
  propose?: Propose,
): Promise<Response> =>
  createMcpHandler(() => nekoServer(load, propose), {
    onerror: (e) => console.error("mcp", e),
  }).fetch(request);
