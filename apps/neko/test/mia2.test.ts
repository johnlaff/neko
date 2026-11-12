import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { localDate } from "@neko/engine";
import { describe, expect, it } from "vitest";
import type { Mia2Line, Mia2Rotina } from "../src/shared/types.ts";
import type { Env } from "../src/worker/env.ts";
import worker from "../src/worker/index.ts";
import { spentThisMonth } from "../src/worker/mia.ts";
import {
  agentConfig,
  CHART_TOOL,
  ensureSetup,
  type Mia2Setup,
  NUMBERS_TOOL,
  runTurn,
  SESSION_CAP_CENTS,
  stopTurn,
} from "../src/worker/mia2.ts";
import { raiseNotice, recentNotices } from "../src/worker/notices.ts";
import {
  loadRoutine,
  ROUTINE_PROMPT,
  routineFor,
  routineReminder,
  routineTitle,
  runRoutine,
} from "../src/worker/routines.ts";
import { sqliteD1 } from "./d1.ts";

const SITE = "https://neko.test";
const TODAY = localDate("2026-11-12");
type Ev = Record<string, unknown> & { type: string };

/**
 * A fake of the Managed Agents API: hands out ids, plays one scripted event stream per question and
 * keeps every request, so a test reads what the Worker sent.
 */
const fakeApi = (opts: { streams?: Ev[][]; history?: Ev[]; cost?: string[] } = {}) => {
  const sent: { method: string; path: string; body: unknown }[] = [];
  const streams = [...(opts.streams ?? [])];
  const costs = [...(opts.cost ?? ["0"])];
  let agentVersion = 0;
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const method = init?.method ?? "GET";
    const path = url.pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    sent.push({ method, path, body });
    const json = (data: unknown) => Response.json(data);
    if (method === "POST" && path === "/v1/environments") return json({ id: "env_1" });
    if (method === "POST" && path === "/v1/memory_stores") return json({ id: "memstore_1" });
    if (method === "POST" && path === "/v1/vaults") return json({ id: "vlt_1" });
    if (method === "POST" && path === "/v1/vaults/vlt_1/credentials") return json({ id: "vcrd_1" });
    if (method === "POST" && path.startsWith("/v1/vaults/vlt_1/credentials/"))
      return json({ id: "vcrd_1" });
    if (method === "POST" && path === "/v1/agents") return json({ id: "agent_1", version: 1 });
    if (method === "POST" && path === "/v1/agents/agent_1")
      return json({ id: "agent_1", version: ++agentVersion + 1 });
    if (method === "POST" && path === "/v1/sessions") return json({ id: "sesn_0000000001" });
    if (method === "GET" && path.endsWith("/events/stream")) {
      const events = streams.shift() ?? [];
      const sse = events.map((e) => `event: message\ndata: ${JSON.stringify(e)}\n\n`).join("");
      return new Response(sse, { headers: { "content-type": "text/event-stream" } });
    }
    if (method === "POST" && path.endsWith("/events")) return json({ data: [] });
    if (method === "GET" && path.endsWith("/events")) return json({ data: opts.history ?? [] });
    if (method === "GET" && path.startsWith("/v1/sessions/")) {
      const amount = costs.length > 1 ? costs.shift() : costs[0];
      return json({ id: path.split("/")[3], usage: { list_cost: { amount, currency: "USD" } } });
    }
    return new Response(`{"type":"error","error":{"type":"not_found_error"}}`, { status: 404 });
  }) as typeof fetch;
  const client = new Anthropic({ apiKey: "test", fetch: f, maxRetries: 0 });
  return {
    client,
    sent,
    posted: (suffix: string) => sent.filter((s) => s.method === "POST" && s.path.endsWith(suffix)),
  };
};

const SETUP: Mia2Setup = {
  environment: "env_1",
  memoryStore: "memstore_1",
  vault: "vlt_1",
  agent: "agent_1",
  version: 1,
};

const turn = async (
  api: ReturnType<typeof fakeApi>,
  db: ReturnType<typeof sqliteD1>,
  ask: { pergunta: string; sessao?: string },
  spentMicroUsd = 0,
) => {
  const lines: Mia2Line[] = [];
  await runTurn(
    {
      client: api.client,
      db: db as unknown as D1Database,
      today: TODAY,
      now: () => new Date("2026-11-12T15:00:00Z"),
      spentMicroUsd,
      write: (l) => lines.push(l),
    },
    SETUP,
    ask,
  );
  return lines;
};

const toolUse = (id: string, name: string, input: unknown): Ev => ({
  type: "agent.mcp_tool_use",
  id,
  name,
  input,
  mcp_server_name: "neko",
});
const toolResult = (useId: string, data: unknown): Ev => ({
  type: "agent.mcp_tool_result",
  id: `r-${useId}`,
  mcp_tool_use_id: useId,
  content: [{ type: "text", text: JSON.stringify(data) }],
});
const message = (id: string, text: string): Ev => ({
  type: "agent.message",
  id,
  content: [{ type: "text", text }],
});
const idle = (type: string): Ev => ({
  type: "session.status_idle",
  id: `idle-${type}`,
  stop_reason: { type },
});

describe("mia2 setup", () => {
  it("makes her objects once, and a new agent version only when her definition changes", async () => {
    const db = sqliteD1();
    const api = fakeApi();
    const d1 = db as unknown as D1Database;
    const first = await ensureSetup(api.client, d1, SITE, "token-1");
    expect(first).toEqual({ ...SETUP });
    const agent = api.posted("/v1/agents")[0]?.body as ReturnType<typeof agentConfig>;
    expect(agent.mcp_servers).toEqual([{ type: "url", name: "neko", url: `${SITE}/api/mcp` }]);
    const credential = api.posted("/credentials")[0]?.body as { auth: Record<string, string> };
    expect(credential.auth).toEqual({
      type: "static_bearer",
      mcp_server_url: `${SITE}/api/mcp`,
      token: "token-1",
    });

    const before = api.sent.length;
    expect(await ensureSetup(api.client, d1, SITE, "token-1")).toEqual(first);
    expect(api.sent.length).toBe(before);

    // A rotated token updates the vault's credential; nothing else is made again.
    await ensureSetup(api.client, d1, SITE, "token-2");
    expect(api.sent.slice(before).map((s) => s.path)).toEqual([
      "/v1/vaults/vlt_1/credentials/vcrd_1",
    ]);

    // A changed definition (here: another address) becomes a new version of the same agent.
    const next = await ensureSetup(api.client, d1, "https://other.test", "token-2");
    expect(next.version).toBe(2);
    expect(api.posted("/v1/agents/agent_1")[0]?.body).toMatchObject({ version: 1 });
  });

  it("keeps the web off and her own tools always allowed", () => {
    const tools = agentConfig(SITE).tools ?? [];
    expect(tools[0]).toMatchObject({
      type: "agent_toolset_20260401",
      configs: [
        { name: "web_fetch", enabled: false },
        { name: "web_search", enabled: false },
      ],
    });
    expect(tools[1]).toMatchObject({ type: "mcp_toolset", mcp_server_name: "neko" });
    expect(tools[2]).toMatchObject({ type: "custom", name: CHART_TOOL });
  });
});

describe("mia2 turn", () => {
  it("opens a conversation under a budget, relays her work and books its cost", async () => {
    const db = sqliteD1();
    const api = fakeApi({
      cost: ["7"],
      streams: [
        [
          { type: "session.status_running", id: "s1" },
          toolUse("u1", "faturas", {}),
          toolResult("u1", { total: 4939.62 }),
          { type: "event_start", event: { type: "agent.message", id: "m1" } },
          {
            type: "event_delta",
            event_id: "m1",
            delta: { type: "content_delta", index: 0, content: { type: "text", text: "Vêm " } },
          },
          message("m1", "Vêm **R$ 4.939,62** nas faturas."),
          idle("end_turn"),
        ],
      ],
    });
    const lines = await turn(api, db, { pergunta: "Quanto vem nas faturas?" });
    expect(lines).toEqual([
      { t: "status", texto: "Abrindo a conversa…" },
      { t: "sessao", id: "sesn_0000000001" },
      { t: "status", texto: "Lendo as faturas…" },
      { t: "parcial", id: "m1", texto: "Vêm " },
      {
        t: "mensagem",
        id: "m1",
        texto: "Vêm **R$ 4.939,62** nas faturas.",
        valores: { "R$ 4.939,62": { conferido: true, tela: "faturas", mes: undefined } },
      },
      { t: "fim" },
    ]);
    const session = api.posted("/v1/sessions")[0]?.body as Record<string, unknown>;
    expect(session).toMatchObject({
      agent: { type: "agent", id: "agent_1", version: 1 },
      vault_ids: ["vlt_1"],
      resources: [{ type: "memory_store", memory_store_id: "memstore_1", access: "read_write" }],
      budget: {
        type: "limit",
        max_list_cost: { amount: String(SESSION_CAP_CENTS), currency: "USD" },
      },
    });
    expect(api.posted("/events")[0]?.body).toEqual({
      events: [
        { type: "user.message", content: [{ type: "text", text: "Quanto vem nas faturas?" }] },
      ],
    });
    // 7 cents booked against the month's cap, once.
    expect(await spentThisMonth(db as unknown as D1Database, TODAY)).toBe(70_000);
  });

  it("goes on in the same conversation and books only what the new question cost", async () => {
    const db = sqliteD1();
    const api = fakeApi({
      cost: ["7", "12"],
      streams: [
        [message("m1", "Oi."), idle("end_turn")],
        [message("m2", "De novo."), idle("end_turn")],
      ],
    });
    const first = await turn(api, db, { pergunta: "Oi" });
    const id = (first.find((l) => l.t === "sessao") as { id: string }).id;
    const second = await turn(api, db, { pergunta: "E agora?", sessao: id });
    expect(second[0]).toEqual({ t: "sessao", id });
    expect(api.posted("/v1/sessions")).toHaveLength(1);
    expect(await spentThisMonth(db as unknown as D1Database, TODAY)).toBe(120_000);
  });

  it("starts a new conversation for an id that is not hers", async () => {
    const db = sqliteD1();
    const api = fakeApi({ streams: [[message("m1", "Oi."), idle("end_turn")]] });
    const lines = await turn(api, db, { pergunta: "Oi", sessao: "sesn_someoneelse" });
    expect(lines).toContainEqual({ t: "sessao", id: "sesn_0000000001" });
  });

  it("asks once more when a value has no source, then marks what still has none", async () => {
    const db = sqliteD1();
    const api = fakeApi({
      streams: [
        [
          toolUse("u1", "hoje", {}),
          toolResult("u1", { saldo_hoje: 1500 }),
          message("m1", "Você tem R$ 1.500 e gasta R$ 320 por semana."),
          idle("end_turn"),
          message("m2", "Você tem R$ 1.500. Gasta R$ 300 por semana."),
          idle("end_turn"),
        ],
      ],
    });
    const lines = await turn(api, db, { pergunta: "Como estou?" });
    const kinds = lines.map((l) => l.t);
    expect(kinds).toEqual([
      "status",
      "sessao",
      "status",
      "mensagem",
      "refazendo",
      "status",
      "mensagem",
      "fim",
    ]);
    const last = lines.filter((l) => l.t === "mensagem").at(-1) as Extract<
      Mia2Line,
      { t: "mensagem" }
    >;
    expect(last.valores["R$ 1.500"]?.conferido).toBe(true);
    expect(last.valores["R$ 300"]?.conferido).toBe(false);
    const correction = api.posted("/events")[1]?.body as { events: Ev[] };
    expect(correction.events.map((e) => e.type)).toEqual(["user.message", "system.message"]);
    expect(JSON.stringify(correction.events[1])).toContain("R$ 320");
  });

  it("finds a value in an earlier question of the conversation before calling it unchecked", async () => {
    const db = sqliteD1();
    const api = fakeApi({
      history: [toolUse("old", "mes", { mes: "2026-09" }), toolResult("old", { saidas: 4321.5 })],
      streams: [[message("m1", "Setembro teve R$ 4.321,50 de saídas."), idle("end_turn")]],
    });
    const lines = await turn(api, db, { pergunta: "E setembro?" });
    const m = lines.find((l) => l.t === "mensagem") as Extract<Mia2Line, { t: "mensagem" }>;
    expect(m.valores["R$ 4.321,50"]).toMatchObject({
      conferido: true,
      tela: "mes",
      mes: "2026-09",
    });
    expect(lines.at(-1)).toEqual({ t: "fim" });
  });

  it("draws a chart whose values check and refuses one whose values do not", async () => {
    const db = sqliteD1();
    const chart = (id: string, valores: number[]): Ev => ({
      type: "agent.custom_tool_use",
      id,
      name: CHART_TOOL,
      input: {
        titulo: "Saídas",
        tipo: "barras",
        rotulos: ["set", "out"],
        series: [{ nome: "Saídas", valores }],
      },
    });
    const api = fakeApi({
      streams: [
        [
          toolUse("u1", "resumo_meses", {}),
          toolResult("u1", {
            meses: [
              { mes: "2026-09", saidas: 4321.5 },
              { mes: "2026-10", saidas: 3900 },
            ],
          }),
          chart("c1", [4321.5, 9999]),
          idle("requires_action"),
          chart("c2", [4321.5, 3900]),
          idle("requires_action"),
          idle("end_turn"),
        ],
      ],
    });
    const lines = await turn(api, db, { pergunta: "Mostra as saídas" });
    expect(lines.filter((l) => l.t === "grafico")).toEqual([
      {
        t: "grafico",
        id: "c2",
        grafico: {
          titulo: "Saídas",
          tipo: "barras",
          rotulos: ["set", "out"],
          series: [{ nome: "Saídas", valores: [4321.5, 3900] }],
        },
      },
    ]);
    const results = api
      .posted("/events")
      .flatMap((s) => (s.body as { events: Ev[] }).events)
      .filter((e) => e.type === "user.custom_tool_result");
    expect(results.map((r) => [r.custom_tool_use_id, r.is_error])).toEqual([
      ["c1", true],
      ["c2", false],
    ]);
    expect(JSON.stringify(results[0])).toContain("9999");
  });

  it("shows a board of numbers that check, each with where it came from, and refuses others", async () => {
    const board = (id: string, valor: number, nota = "vencem 12/12"): Ev => ({
      type: "agent.custom_tool_use",
      id,
      name: NUMBERS_TOOL,
      input: {
        itens: [
          { rotulo: "Saídas de setembro", valor: 4321.5 },
          { rotulo: "Faturas abertas", valor, nota },
        ],
      },
    });
    const api = fakeApi({
      streams: [
        [
          toolUse("u1", "mes", { mes: "2026-09" }),
          toolResult("u1", { saidas: 4321.5 }),
          toolUse("u2", "faturas", {}),
          toolResult("u2", { abertas: 3115.13 }),
          message("m1", "Setembro foi o mês mais caro."),
          board("n1", 9999),
          idle("requires_action"),
          // A value in a note is checked as one in her text is.
          board("n2", 3115.13, "faltam R$ 9.999"),
          idle("requires_action"),
          board("n3", 3115.13),
          idle("requires_action"),
          idle("end_turn"),
        ],
      ],
    });
    const lines = await turn(api, sqliteD1(), { pergunta: "Como estou?" });
    expect(lines.filter((l) => l.t === "numeros")).toEqual([
      {
        t: "numeros",
        id: "n3",
        numeros: [
          { rotulo: "Saídas de setembro", valor: 4321.5, tela: "mes", mes: "2026-09" },
          { rotulo: "Faturas abertas", valor: 3115.13, nota: "vencem 12/12", tela: "faturas" },
        ],
      },
    ]);
    const results = api
      .posted("/events")
      .flatMap((s) => (s.body as { events: Ev[] }).events)
      .filter((e) => e.type === "user.custom_tool_result");
    expect(results.map((r) => [r.custom_tool_use_id, r.is_error])).toEqual([
      ["n1", true],
      ["n2", true],
      ["n3", false],
    ]);
  });

  it("puts her answer before a chart she drew first", async () => {
    const draw = (id: string): Ev => ({
      type: "agent.custom_tool_use",
      id,
      name: CHART_TOOL,
      input: {
        titulo: "Saídas",
        tipo: "barras",
        rotulos: ["set", "out"],
        series: [{ nome: "Saídas", valores: [4321.5, 3900] }],
      },
    });
    const read = [
      toolUse("u1", "resumo_meses", {}),
      toolResult("u1", {
        meses: [
          { mes: "2026-09", saidas: 4321.5 },
          { mes: "2026-10", saidas: 3900 },
        ],
      }),
    ];
    const kinds = async (stream: Ev[], pergunta: string) =>
      (await turn(fakeApi({ streams: [stream] }), sqliteD1(), { pergunta }))
        .filter((l) => l.t !== "status")
        .map((l) => l.t);
    const said = [message("m1", "Outubro caiu."), idle("end_turn")];
    expect(
      await kinds([...read, draw("c1"), idle("requires_action"), ...said], "Mostra as saídas"),
    ).toEqual(["sessao", "mensagem", "grafico", "fim"]);
    // A chart with no words after it still reaches the owner.
    const only = [...read, draw("c2"), idle("requires_action"), idle("end_turn")];
    expect(await kinds(only, "Só o gráfico")).toEqual(["sessao", "grafico", "fim"]);
  });

  it("says when the conversation or the month reached its limit", async () => {
    const db = sqliteD1();
    const api = fakeApi({ streams: [[idle("budget_reached")]] });
    expect((await turn(api, db, { pergunta: "Oi" })).at(-1)).toEqual({
      t: "erro",
      motivo: "limite_conversa",
    });
    const broke = fakeApi();
    expect(await turn(broke, sqliteD1(), { pergunta: "Oi" }, 79_999_000)).toEqual([
      { t: "erro", motivo: "limite_mes" },
    ]);
    expect(broke.sent).toHaveLength(0);
  });

  it("gives a conversation no more than what is left of the month", async () => {
    const api = fakeApi({ streams: [[idle("end_turn")]] });
    await turn(api, sqliteD1(), { pergunta: "Oi" }, 79_500_000);
    expect(api.posted("/v1/sessions")[0]?.body).toMatchObject({
      budget: { max_list_cost: { amount: "50" } },
    });
  });

  it("stops her and says so when the stream ends before she is done", async () => {
    const api = fakeApi({ streams: [[toolUse("u1", "hoje", {})]] });
    const lines = await turn(api, sqliteD1(), { pergunta: "Oi" });
    expect(lines.at(-1)).toEqual({ t: "erro", motivo: "falha" });
  });

  it("keeps what she said when the owner stops her, and redoes nothing", async () => {
    const api = fakeApi({
      streams: [
        [
          message("m1", "Você gasta R$ 320 por semana."),
          { type: "user.interrupt", id: "i1" },
          idle("end_turn"),
        ],
      ],
    });
    const lines = await turn(api, sqliteD1(), { pergunta: "Oi" });
    expect(lines.map((l) => l.t)).toEqual(["status", "sessao", "mensagem", "fim"]);
    expect(api.posted("/events")).toHaveLength(1);
  });

  it("interrupts only her own conversations", async () => {
    const db = sqliteD1();
    const api = fakeApi({ streams: [[idle("end_turn")]] });
    await turn(api, db, { pergunta: "Oi" });
    const d1 = db as unknown as D1Database;
    expect(await stopTurn(api.client, d1, "sesn_someoneelse")).toBe(false);
    expect(await stopTurn(api.client, d1, "sesn_0000000001")).toBe(true);
    expect(api.posted("/events").at(-1)?.body).toEqual({ events: [{ type: "user.interrupt" }] });
  });
});

describe("mia2 routines", () => {
  it("come on Sunday and on the 1st, the 1st winning when it is a Sunday", () => {
    expect(routineFor(localDate("2026-11-15"))).toBe("semana");
    expect(routineFor(localDate("2026-12-01"))).toBe("mes");
    expect(routineFor(localDate("2027-08-01"))).toBe("mes");
    expect(routineFor(localDate("2026-11-12"))).toBeNull();
  });

  it("ask her with no digits, which the check would take as the owner's numbers", () => {
    for (const prompt of Object.values(ROUTINE_PROMPT)) expect(prompt).not.toMatch(/\d/);
  });

  const SUNDAY = localDate("2026-11-15");
  const routine = async (api: ReturnType<typeof fakeApi>, today = SUNDAY) => {
    const db = sqliteD1();
    const d1 = db as unknown as D1Database;
    const told: Mia2Rotina[] = [];
    const r = await runRoutine({
      client: api.client,
      db: d1,
      today,
      now: () => new Date(`${today}T09:05:00Z`),
      spentMicroUsd: 0,
      setup: SETUP,
      notify: async (x) => {
        told.push(x);
      },
    });
    return { r, told, d1 };
  };

  it("keep Sunday's answer for the Mia screen and tell the phone once", async () => {
    const api = fakeApi({
      streams: [
        [
          toolUse("u1", "semana", {}),
          toolResult("u1", { cartoes_e_pix: 812.4, semana_anterior: 1020 }),
          toolUse("u2", "hoje", {}),
          toolResult("u2", { teto_do_mes: { ainda_cabem: 1460.1 } }),
          message("m1", "A semana levou **R$ 812,40** em cartões e Pix, menos que a anterior."),
          {
            type: "agent.custom_tool_use",
            id: "n1",
            name: NUMBERS_TOOL,
            input: {
              itens: [
                { rotulo: "Na semana", valor: 812.4 },
                { rotulo: "Cabe no teto", valor: 1460.1 },
              ],
            },
          },
          idle("requires_action"),
          idle("end_turn"),
        ],
      ],
    });
    const { r, told, d1 } = await routine(api);
    const sent = api.posted("/events")[0]?.body as { events: { content: { text: string }[] }[] };
    expect(sent.events[0]?.content[0]?.text).toBe(ROUTINE_PROMPT.semana);
    expect(r).toMatchObject({
      id: "semana:2026-11-15",
      tipo: "semana",
      titulo: "Semana de 8 a 14 nov",
      dia: "2026-11-15",
      sessao: "sesn_0000000001",
    });
    expect(r?.partes.map((p) => p.t)).toEqual(["mensagem", "numeros"]);
    expect(told).toEqual([r]);
    // GET /api/mia2/rotina, as the Android app reads it (Mia2ChatTest).
    const view = `${JSON.stringify({ rotina: r }, null, 2)}\n`;
    const path = join(import.meta.dirname, "../../android/app/src/test/resources/mia2-rotina.json");
    if (process.env.UPDATE_CONTRACT) writeFileSync(path, view);
    expect(readFileSync(path, "utf8")).toBe(view);
    expect(await loadRoutine(d1, localDate("2026-11-21"))).toEqual(r);
    // A week on, it is old news.
    expect(await loadRoutine(d1, localDate("2026-11-22"))).toBeNull();
  });

  it("keep only the answer she redid, and nothing when she could not finish", async () => {
    const redo = fakeApi({
      streams: [
        [
          toolUse("u1", "semana", {}),
          toolResult("u1", { cartoes_e_pix: 812.4 }),
          message("m1", "A semana levou **R$ 9.999**."),
          idle("end_turn"),
          message("m2", "A semana levou **R$ 812,40**."),
          idle("end_turn"),
        ],
      ],
    });
    const { r } = await routine(redo);
    expect(r?.partes).toEqual([
      {
        t: "mensagem",
        id: "m2",
        texto: "A semana levou **R$ 812,40**.",
        valores: { "R$ 812,40": { conferido: true, tela: "hoje" } },
      },
    ]);

    const broken = fakeApi({
      streams: [[message("m1", "A semana"), { type: "session.status_terminated", id: "t" }]],
    });
    const failed = await routine(broken);
    expect(failed.r).toBeNull();
    expect(failed.told).toEqual([]);
    expect(await loadRoutine(failed.d1, SUNDAY)).toBeNull();
  });

  it("name the week by its days, and the month closed", () => {
    expect(routineTitle("semana", localDate("2026-11-15"))).toBe("Semana de 8 a 14 nov");
    expect(routineTitle("semana", localDate("2026-12-06"))).toBe("Semana de 29 nov a 5 dez");
    expect(routineTitle("mes", localDate("2027-01-01"))).toBe("Fechamento de dezembro");
  });

  it("do nothing on other days", async () => {
    const api = fakeApi();
    const { r } = await routine(api, localDate("2026-11-12"));
    expect(r).toBeNull();
    expect(api.sent).toEqual([]);
  });

  it("tell the phone with her first sentence, plain, opening the Mia screen", async () => {
    const r: Mia2Rotina = {
      id: "mes:2026-12-01",
      tipo: "mes",
      titulo: "Fechamento de novembro",
      dia: "2026-12-01",
      sessao: "sesn_0000000001",
      partes: [
        {
          t: "mensagem",
          id: "m1",
          texto: "Novembro fechou com **R$ 640** guardados, 9% das entradas.\n- Diário de R$ 92",
          valores: {},
        },
      ],
    };
    const reminder = routineReminder(r);
    expect(reminder).toEqual({
      title: "A Mia fechou novembro",
      body: "Novembro fechou com R$ 640 guardados, 9% das entradas.",
      url: "/mia",
      tag: "mia",
    });
    const d1 = sqliteD1() as unknown as D1Database;
    const now = new Date("2026-12-01T09:06:00Z");
    await raiseNotice({ DB: d1 } as unknown as Env, "mia", localDate("2026-12-01"), reminder, now);
    expect(await recentNotices(d1, now)).toEqual([{ id: "mia:2026-12-01", ...reminder }]);
  });
});

describe("mia2 routes", () => {
  it("are behind the session, the question and the Stop alike", async () => {
    const env = {
      DB: sqliteD1() as unknown as D1Database,
      ANTHROPIC_API_KEY: "k",
      MIA_MCP_TOKEN: "t",
      SITE_URL: SITE,
    } as unknown as Env;
    for (const path of ["/api/mia2", "/api/mia2/parar"]) {
      const res = await worker.fetch(
        new Request(`${SITE}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pergunta: "Oi", sessao: "sesn_0000000001" }),
        }) as never,
        env,
        {} as ExecutionContext,
      );
      expect(res.status).toBe(401);
    }
  });
});

/**
 * The Android app reads her answer from this file in its unit tests (Mia2ChatTest), so both sides
 * agree on the lines. UPDATE_CONTRACT=1 rewrites it after an intended change.
 */
describe("mia2 android contract", () => {
  it("matches the lines the app reads", async () => {
    const api = fakeApi({
      streams: [
        [
          toolUse("u1", "resumo_meses", { de: "2026-09", ate: "2026-10" }),
          toolResult("u1", {
            meses: [
              { mes: "2026-09", saidas: 4630.55 },
              { mes: "2026-10", saidas: 4180.4 },
            ],
          }),
          { type: "event_start", id: "s1", event: { type: "agent.message", id: "m1" } },
          {
            type: "event_delta",
            id: "d1",
            event_id: "m1",
            delta: { content: { type: "text", text: "Outubro fechou em " } },
          },
          message("m1", "Outubro fechou em **R$ 4.180,40**, menos que os R$ 4.630,55 de setembro."),
          {
            type: "agent.custom_tool_use",
            id: "c1",
            name: CHART_TOOL,
            input: {
              titulo: "Saídas por mês",
              tipo: "barras",
              rotulos: ["set", "out"],
              series: [{ nome: "Saídas", valores: [4630.55, 4180.4] }],
            },
          },
          idle("requires_action"),
          {
            type: "agent.custom_tool_use",
            id: "n1",
            name: NUMBERS_TOOL,
            input: {
              itens: [
                { rotulo: "Saídas de outubro", valor: 4180.4 },
                { rotulo: "Saídas de setembro", valor: 4630.55, nota: "o mês mais caro" },
              ],
            },
          },
          idle("requires_action"),
          idle("end_turn"),
        ],
      ],
    });
    const lines = await turn(api, sqliteD1(), { pergunta: "Como foram os últimos meses?" });
    const text = `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`;
    const path = join(import.meta.dirname, "../../android/app/src/test/resources/mia2.ndjson");
    if (process.env.UPDATE_CONTRACT) writeFileSync(path, text);
    expect(readFileSync(path, "utf8")).toBe(text);
  });
});
