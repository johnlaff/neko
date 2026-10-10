import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { localDate, type Projection } from "@neko/engine";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/worker/env.ts";
import worker from "../src/worker/index.ts";
import {
  askMia,
  CAP_MICRO_USD,
  costMicroUsd,
  ENTRY_TOOL,
  FALLBACK,
  fillEntry,
  HAIKU,
  type MiaDeps,
  MiaEntryRequest,
  MiaRequest,
  recordUsage,
  SONNET,
  spentThisMonth,
  TOOLS,
} from "../src/worker/mia.ts";
import { sqliteD1 } from "./d1.ts";

// The invented sheet of the smoke test: no real finances in a public repo.
const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "e2e", "projection.json"), "utf8"),
) as { projection: Projection };
const P = fixture.projection;
const TODAY = localDate("2026-10-05");

type Reply = { content: unknown[]; stop_reason?: string };
const usage = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 3000 };
const tool = (name: string, input: unknown, id = `t-${name}`) => ({
  type: "tool_use",
  id,
  name,
  input,
});
const answer = (texto: string, precisa_escalar = false) =>
  tool("responder", { texto, precisa_escalar }, "t-answer");

/** A fake Messages API: hands out the scripted replies per model and keeps every request. */
const fakeApi = (script: Partial<Record<string, Reply[]>>) => {
  const sent: { model: string; body: Record<string, unknown> }[] = [];
  const recorded: { model: string; micro: number }[] = [];
  const f = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const model = String(body.model);
    sent.push({ model, body });
    const next = script[model]?.shift();
    if (!next) return new Response("{}", { status: 500 });
    return Response.json({ stop_reason: "tool_use", usage, ...next });
  }) as typeof fetch;
  const deps: MiaDeps = {
    fetch: f,
    key: "test-key",
    spentMicroUsd: 0,
    record: async (model, u) => {
      recorded.push({ model, micro: costMicroUsd(model, u) });
    },
  };
  return { deps, sent, recorded };
};

const ask = (pergunta: string) => MiaRequest.parse({ pergunta });

describe("askMia: the engine computes, the model only points", () => {
  it("runs the tool the model picks and answers with the values it cites", async () => {
    const api = fakeApi({
      [HAIKU]: [
        { content: [tool("mes", { mes: "2026-09" })] },
        { content: [answer("Em setembro saíram {{v2}}.")], stop_reason: "end_turn" },
      ],
    });
    const out = await askMia(api.deps, P, TODAY, ask("Quanto saiu em setembro?"));
    const saidas = P.months.find((m) => m.year === 2026 && m.month === 9)?.saida;
    expect(out.modelo).toBe(HAIKU);
    expect(out.texto).toBe("Em setembro saíram {{v2}}.");
    expect(out.valores).toEqual({
      v2: expect.objectContaining({ cents: saidas, tipo: "total", tela: "mes", mes: "2026-09" }),
    });
    // The tool result goes back as JSON, with refs and no money written out.
    const second = api.sent[1]?.body.messages as { content: unknown }[];
    expect(JSON.stringify(second.at(-1))).toContain('\\"ref\\":\\"v2\\"');
    expect(api.recorded).toHaveLength(2);
  });

  it("puts today in the question and keeps the prompt prefix fixed", async () => {
    const api = fakeApi({ [HAIKU]: [{ content: [answer("Oi!")] }, { content: [answer("Oi!")] }] });
    await askMia(api.deps, P, TODAY, ask("Oi"));
    await askMia(api.deps, P, localDate("2026-10-06"), ask("Oi"));
    const [a, b] = api.sent.map((s) => s.body);
    expect(JSON.stringify(a?.messages)).toContain("[hoje: 2026-10-05] Oi");
    expect(JSON.stringify([a?.system, a?.tools])).toBe(JSON.stringify([b?.system, b?.tools]));
    expect(a?.tool_choice).toEqual({ type: "any" });
  });

  it("sends a refused answer back once with the reason, then takes the fix", async () => {
    const api = fakeApi({
      [HAIKU]: [
        { content: [tool("hoje", {})] },
        { content: [answer("Seu saldo é R$ 100,00.")] },
        { content: [answer("Seu saldo é {{v1}}.")] },
      ],
    });
    const out = await askMia(api.deps, P, TODAY, ask("Qual meu saldo?"));
    expect(out.texto).toBe("Seu saldo é {{v1}}.");
    const retry = api.sent[2]?.body.messages as { content: unknown }[];
    expect(JSON.stringify(retry.at(-1))).toContain("escreveu dinheiro");
  });

  it("escalates to Sonnet after two refused answers", async () => {
    const api = fakeApi({
      [HAIKU]: [
        { content: [answer("Foram R$ 10,00.")] },
        { content: [answer("Somando {{v1}} dá mais.")] },
      ],
      [SONNET]: [
        { content: [tool("hoje", {})] },
        { content: [{ type: "text", text: "Hoje o saldo é {{v1}}." }], stop_reason: "end_turn" },
      ],
    });
    const out = await askMia(api.deps, P, TODAY, ask("Qual meu saldo?"));
    expect(out.modelo).toBe(SONNET);
    expect(out.texto).toBe("Hoje o saldo é {{v1}}.");
    expect(api.sent.find((s) => s.model === SONNET)?.body.tool_choice).toEqual({ type: "auto" });
  });

  it("escalates when Haiku asks or refuses", async () => {
    for (const reply of [
      { content: [answer("Não sei.", true)] },
      { content: [], stop_reason: "refusal" },
    ]) {
      const api = fakeApi({
        [HAIKU]: [reply],
        [SONNET]: [{ content: [answer("Não consigo ver isso na planilha.")] }],
      });
      const out = await askMia(api.deps, P, TODAY, ask("Devo investir?"));
      expect(out.modelo).toBe(SONNET);
    }
  });

  it("does not escalate past 70% of the cap, and says so without numbers", async () => {
    const api = fakeApi({ [HAIKU]: [{ content: [answer("x", true)] }] });
    const deps = { ...api.deps, spentMicroUsd: CAP_MICRO_USD * 0.7 };
    const out = await askMia(deps, P, TODAY, ask("Devo investir?"));
    expect(out).toEqual({ texto: FALLBACK, valores: {}, modelo: null });
    expect(api.sent.every((s) => s.model === HAIKU)).toBe(true);
  });

  it("stops after four calls in one attempt", async () => {
    const loop = Array.from({ length: 4 }, () => ({ content: [tool("hoje", {})] }));
    const api = fakeApi({ [HAIKU]: loop, [SONNET]: [...loop] });
    const out = await askMia(api.deps, P, TODAY, ask("?"));
    expect(out.modelo).toBe(null);
    expect(api.sent).toHaveLength(8);
  });

  it("continues the numbering of earlier answers and cites their values", async () => {
    const api = fakeApi({ [HAIKU]: [{ content: [answer("Como antes, {{v1}}.")] }] });
    const req = MiaRequest.parse({
      pergunta: "E aquilo?",
      historico: [{ pergunta: "Saldo?", resposta: "{{v1}}" }],
      valores: { v1: { tipo: "saldo", rotulo: "Saldo de hoje", tela: "hoje", cents: 100 } },
    });
    const out = await askMia(api.deps, P, TODAY, req);
    expect(out.valores.v1).toMatchObject({ cents: 100 });
  });
});

describe("tools for the API", () => {
  it("are strict, closed objects with every property required", () => {
    for (const t of TOOLS) {
      expect(t.strict).toBe(true);
      expect(t.input_schema.additionalProperties).toBe(false);
      expect(t.input_schema.required).toEqual(Object.keys(t.input_schema.properties));
    }
  });
});

describe("spending", () => {
  it("prices a call from its usage, rounding up", () => {
    const u = {
      input_tokens: 100_000,
      output_tokens: 1_000_000,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    };
    expect(costMicroUsd(HAIKU, u)).toBe(510_000);
    expect(costMicroUsd(SONNET, u)).toBe(10_200_000);
    // Haiku's price steps up fivefold past 100K prompt tokens.
    expect(costMicroUsd(HAIKU, { ...u, input_tokens: 100_001 })).toBe(2_550_001);
    expect(costMicroUsd(HAIKU, { ...u, input_tokens: 3, output_tokens: 0 })).toBe(1);
  });

  it("adds up the month in D1", async () => {
    const db = sqliteD1() as unknown as D1Database;
    const record = recordUsage(db, TODAY, new Date("2026-10-05T12:00:00Z"));
    const u = {
      input_tokens: 1_000_000,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    };
    await record(SONNET, u);
    await record(HAIKU, u);
    // A million prompt tokens is past Haiku's step: 5 × US$ 0,10.
    expect(await spentThisMonth(db, TODAY)).toBe(2_500_000);
    expect(await spentThisMonth(db, localDate("2026-11-01"))).toBe(0);
  });
});

describe("fillEntry: Mia fills Lançar, the engine keeps what it trusts", () => {
  const entry = (frase: string, cartoes: string[] = []) =>
    MiaEntryRequest.parse({ frase, cartoes });
  const filled = (input: Record<string, unknown>) =>
    fakeApi({ [HAIKU]: [{ content: [tool("lancamento", input)] }] });

  it("forces one Haiku call to the form tool, with today and the cards in the sentence", async () => {
    const api = filled({
      tipo: "cartao",
      valor: 120,
      dia: "2026-10-04",
      nome: "Farmácia",
      cartao: "Nubank",
      parcelas: 3,
    });
    const out = await fillEntry(
      api.deps,
      TODAY,
      entry("farmácia 120 no nubank em 3x ontem", ["Nubank"]),
    );
    expect(out).toEqual({
      kind: "cartao",
      card: "Nubank",
      installments: 3,
      amount: 12000,
      date: "2026-10-04",
      description: "Farmácia",
    });
    expect(api.sent).toHaveLength(1);
    const body = api.sent[0]?.body ?? {};
    expect(body.model).toBe(HAIKU);
    expect(body.tool_choice).toEqual({ type: "tool", name: "lancamento" });
    expect(body.messages).toEqual([
      {
        role: "user",
        content: "[hoje: 2026-10-05] [cartões: Nubank] farmácia 120 no nubank em 3x ontem",
      },
    ]);
    expect(api.recorded).toHaveLength(1);
  });

  it("gives nothing when the sentence is not an entry", async () => {
    const api = filled({
      tipo: "nao_entendi",
      valor: 0,
      dia: "",
      nome: "",
      cartao: "",
      parcelas: 1,
    });
    expect(await fillEntry(api.deps, TODAY, entry("oi Mia"))).toBeNull();
  });

  it("has a strict, closed form tool", () => {
    expect(ENTRY_TOOL.strict).toBe(true);
    expect(ENTRY_TOOL.input_schema.additionalProperties).toBe(false);
    expect(ENTRY_TOOL.input_schema.required).toEqual(
      Object.keys(ENTRY_TOOL.input_schema.properties),
    );
  });
});

describe("routes", () => {
  const env = (over: Partial<Env> = {}) =>
    ({ DB: sqliteD1() as unknown as D1Database, ...over }) as Env;

  it("are behind the session", async () => {
    const res = await worker.fetch(
      new Request("https://neko.test/api/mia"),
      env({ ANTHROPIC_API_KEY: "k" }),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(401);
    const entry = await worker.fetch(
      new Request("https://neko.test/api/mia/lancamento", { method: "POST", body: "{}" }),
      env({ ANTHROPIC_API_KEY: "k" }),
      {} as ExecutionContext,
    );
    // A POST without the session is turned away before Mia (the origin check comes first).
    expect([401, 403]).toContain(entry.status);
  });
});

/**
 * The Android app parses this reply in its unit tests (ScreensContractTest), so both sides agree
 * on the value fields. UPDATE_CONTRACT=1 rewrites it after an intended change.
 */
describe("android contract", () => {
  it("matches a reply with a total, a difference and a percent", async () => {
    const api = fakeApi({
      [HAIKU]: [
        { content: [tool("comparar_meses", { a: "2026-08", b: "2026-09" })] },
        { content: [answer("Entraram {{v2}} em setembro: {{v3}} a mais, ou {{v4}}.")] },
      ],
    });
    const reply = await askMia(api.deps, P, TODAY, ask("Entrou mais em setembro?"));
    expect(Object.keys(reply.valores)).toEqual(["v2", "v3", "v4"]);
    const path = join(import.meta.dirname, "../../android/app/src/test/resources/mia.json");
    if (process.env.UPDATE_CONTRACT) writeFileSync(path, `${JSON.stringify(reply, null, 2)}\n`);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(reply);
  });

  it("matches a filled Lançar form", async () => {
    const api = fakeApi({
      [HAIKU]: [
        {
          content: [
            tool("lancamento", {
              tipo: "pix",
              valor: 45.9,
              dia: "2026-10-05",
              nome: "Padaria",
              cartao: "",
              parcelas: 1,
            }),
          ],
        },
      ],
    });
    const reply = {
      lancamento: await fillEntry(
        api.deps,
        TODAY,
        MiaEntryRequest.parse({ frase: "padaria 45,90 no pix" }),
      ),
    };
    const path = join(
      import.meta.dirname,
      "../../android/app/src/test/resources/mia-lancamento.json",
    );
    if (process.env.UPDATE_CONTRACT) writeFileSync(path, `${JSON.stringify(reply, null, 2)}\n`);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(reply);
  });
});
