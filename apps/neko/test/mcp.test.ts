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
      "semana",
      "resumo_meses",
      "dias_do_mes",
      "simular",
      "posso_comprar",
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

  it("checks a purchase against the ceiling and the balance, in reais", async () => {
    const buy = await call("posso_comprar", { valor: 600, parcelas: 3, dura_meses: 60 });
    expect(buy.error).toBe(false);
    expect(["cabe", "aperta", "nao_cabe"]).toContain(buy.out.veredito);
    expect(buy.out.ritmo).toBe("teto");
    expect(buy.out.compra).toMatchObject({
      valor: 600,
      meio: "cartao",
      parcelas: 3,
      dura_meses: 60,
    });
    // Split, how long it lasts is asked for: the method's rule can't be skipped by leaving it out.
    expect((await call("posso_comprar", { valor: 600, parcelas: 3 })).error).toBe(true);
    expect(buy.out.compra.valor_da_parcela).toBe(200);
    const fits = buy.out.ainda_cabem;
    if (fits) expect(fits.depois).toBeCloseTo(fits.antes - 200, 2);
    expect(buy.out.teto_por_mes).toBe(3800);
    expect(buy.out.menor_saldo.com_a_compra.saldo).toBeLessThanOrEqual(
      buy.out.menor_saldo.sem_a_compra.saldo,
    );

    const pix = await call("posso_comprar", { valor: 50, meio: "pix" });
    expect(pix.out.compra).toMatchObject({ meio: "pix", parcelas: 1, primeira: pix.out.hoje });
    expect((await call("posso_comprar", { valor: 50, meio: "pix", parcelas: 2 })).error).toBe(true);
    // A Pix far bigger than the balance never fits.
    const huge = await call("posso_comprar", { valor: 9_000_000, meio: "pix" });
    expect(huge.out.veredito).toBe("nao_cabe");
    // A dinner in 3x: the parcels outlast it, so it never comes back as a plain "cabe".
    const dinner = await call("posso_comprar", { valor: 90, parcelas: 3, dura_meses: 0 });
    expect(dinner.out.veredito).not.toBe("cabe");
    expect(dinner.out.motivos).toContain(
      "as parcelas duram mais que o bem; o método só parcela o que dura, e não além disso",
    );
  });

  it("reads the last whole week, as Sunday's summary does", async () => {
    const week = await call("semana");
    if (fixture.week) {
      expect(week.out).toMatchObject({
        de: fixture.week.from,
        cartoes_e_pix: fixture.week.total / 100,
      });
    } else expect(week.error).toBe(true);
    const withWeek = async (): Promise<McpData> => ({
      data: {
        ...fixture,
        week: { from: "2026-11-08", to: "2026-11-14", total: 81_240, previous: 102_000 },
        habit: { ...fixture.habit, lastWeek: 5 } as ProjectionResponse["habit"],
      } as ProjectionResponse,
      ceiling: null,
    });
    const r = await result(
      await serveMcp(modern("tools/call", { name: "semana", arguments: {} }, "semana"), withWeek),
    );
    expect(JSON.parse(r.content[0].text)).toEqual({
      de: "2026-11-08",
      ate: "2026-11-14",
      cartoes_e_pix: 812.4,
      semana_anterior: 1020,
      diferenca: -207.6,
      dias_lancados: 5,
    });
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
