import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cents, type EntryInput } from "@neko/engine";
import { describe, expect, it } from "vitest";
import type { ProjectionResponse } from "../src/shared/types.ts";
import type { Env } from "../src/worker/env.ts";
import worker from "../src/worker/index.ts";
import { type McpData, serveMcp } from "../src/worker/mcp.ts";

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "e2e", "projection.json"), "utf8"),
) as ProjectionResponse;
const load = async (): Promise<McpData> => ({ data: fixture, ceiling: cents(3_800_00) });

let id = 0;
/** A 2026-07-28 request: no handshake, the version and method in headers and `_meta`. */
const modern = (method: string, params: Record<string, unknown> = {}, name?: string) =>
  new Request("https://neko.test/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
      ...(name ? { "mcp-name": name } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++id,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });

/** A 2025-era request, as clients that still open with `initialize` send it. */
const legacy = (method: string, params: Record<string, unknown> = {}) =>
  new Request("https://neko.test/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });

/** The JSON-RPC result, whether it came as JSON or as one SSE event. */
const result = async (res: Response) => {
  const text = await res.text();
  const json = res.headers.get("content-type")?.includes("text/event-stream")
    ? JSON.parse(
        text
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5))
          .join(""),
      )
    : JSON.parse(text);
  if (json.error) throw new Error(JSON.stringify(json.error));
  return json.result;
};

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await result(
    await serveMcp(modern("tools/call", { name, arguments: args }, name), load),
  );
  return {
    error: r.isError === true,
    out: r.isError ? r.content[0].text : JSON.parse(r.content[0].text),
  };
};

describe("mcp", () => {
  it("lists the read-only tools in both protocol eras", async () => {
    const now = await result(await serveMcp(modern("tools/list"), load));
    const names = now.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual([
      "periodo",
      "hoje",
      "mes",
      "comparar_meses",
      "gasto_com",
      "faturas",
      "reserva",
      "resumo_meses",
      "dias_do_mes",
      "simular",
      "para_lancar",
    ]);
    expect(
      now.tools.every(
        (t: { annotations?: { readOnlyHint?: boolean } }) => t.annotations?.readOnlyHint,
      ),
    ).toBe(true);

    const init = await result(
      await serveMcp(
        legacy("initialize", {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "old", version: "1" },
        }),
        load,
      ),
    );
    expect(init.capabilities.tools).toBeDefined();
    const old = await result(await serveMcp(legacy("tools/list"), load));
    expect(old.tools).toHaveLength(names.length);
  });

  it("answers in reais, from the same engine as Mia 1", async () => {
    const today = await call("hoje");
    expect(today.out.hoje).toBe(fixture.projection.today);
    expect(today.out.saldo_hoje).toBe((fixture.projection.balanceToday ?? 0) / 100);

    const first = fixture.projection.months[0];
    if (!first) throw new Error("fixture without months");
    const key = `${first.year}-${String(first.month).padStart(2, "0")}`;
    const month = await call("mes", { mes: key });
    expect(month.out.entradas).toBe(first.entrada / 100);
    expect(month.out.saldo_final).toBe(first.endSheet / 100);

    const days = await call("dias_do_mes", { mes: key });
    expect(days.out.dias).toHaveLength(first.days.length);
    expect(days.out.dias[0].data).toBe(`${key}-01`);

    const summary = await call("resumo_meses", { de: key, ate: "2099-12" });
    expect(summary.out.meses[0]).toMatchObject({ mes: key, resultado: first.result / 100 });
  });

  it("simulates without saving, purchases in reais", async () => {
    const plain = await call("simular", { ritmo: "planilha" });
    expect(plain.error).toBe(false);
    expect(plain.out.ritmo).toBe("planilha");
    expect(plain.out.efeito_das_mudancas).toBeNull();
    const buy = await call("simular", {
      ritmo: "planilha",
      mudancas: [{ tipo: "compra", valor: 1200, parcelas: 3 }],
    });
    expect(buy.out.efeito_das_mudancas.no_fim).toBe(-1200);
  });

  it("refuses what it cannot read, as an error the agent can correct", async () => {
    expect((await call("mes", { mes: "1999-01" })).error).toBe(true);
    expect((await call("resumo_meses", { de: "2027-05", ate: "2026-01" })).error).toBe(true);
  });

  it("leaves an entry in Para lançar through propor_lancamento, never in the sheet", async () => {
    const kept: EntryInput[] = [];
    const propose = async (e: EntryInput) => {
      kept.push(e);
    };
    const listed = await result(await serveMcp(modern("tools/list"), load, propose));
    const tool = listed.tools.find((t: { name: string }) => t.name === "propor_lancamento");
    expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    const ask = async (args: Record<string, unknown>) => {
      const r = await result(
        await serveMcp(
          modern("tools/call", { name: "propor_lancamento", arguments: args }, "propor_lancamento"),
          load,
          propose,
        ),
      );
      return r.isError === true ? null : JSON.parse(r.content[0].text);
    };
    const today = fixture.projection.today;
    expect(await ask({ tipo: "pix", valor: 52.3, nome: "Mercado" })).toMatchObject({
      em_para_lancar: true,
      lancamento: { tipo: "pix", valor: 52.3, dia: today, nome: "Mercado" },
    });
    expect(kept).toEqual([{ kind: "diario", amount: 5230, date: today, description: "Mercado" }]);
    // A card it does not know, or a day far from today, is refused and nothing is kept.
    expect(await ask({ tipo: "cartao", valor: 100, nome: "Tênis", cartao: "Outro" })).toBeNull();
    expect(await ask({ tipo: "pix", valor: 10, nome: "Feira", dia: "1999-01-05" })).toBeNull();
    expect(kept).toHaveLength(1);
  });

  it("is off without the secret and closed to a wrong token", async () => {
    const env = { SESSION_SECRET: "s", MIA_MCP_TOKEN: "right-token" } as unknown as Env;
    const ask = (auth?: string) =>
      worker.fetch(
        new Request("https://neko.test/api/mcp", {
          method: "POST",
          headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
          body: "{}",
        }) as never,
        env,
        {} as ExecutionContext,
      );
    expect((await ask()).status).toBe(401);
    expect((await ask("Bearer wrong-token")).status).toBe(401);
    const off = await worker.fetch(
      new Request("https://neko.test/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }) as never,
      { SESSION_SECRET: "s" } as unknown as Env,
      {} as ExecutionContext,
    );
    expect(off.status).toBe(404);
  });
});
