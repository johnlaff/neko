import { describe, expect, it } from "vitest";
import type { MiaReply } from "../src/web/api.ts";
import { miaNext, miaSources, miaStarters, miaWaiting } from "../src/web/Mia.tsx";

const reply = (valores: MiaReply["valores"]): MiaReply =>
  ({ texto: "", valores, modelo: "claude-haiku-5-5" }) as MiaReply;

describe("Mia panel", () => {
  it("offers the screens an answer came from, once each, never Hoje, two at most", () => {
    const r = reply({
      v1: { tipo: "total", rotulo: "a", tela: "mes", mes: "2026-09", cents: 1 },
      v2: { tipo: "total", rotulo: "b", tela: "mes", mes: "2026-09", cents: 2 },
      v3: { tipo: "total", rotulo: "c", tela: "hoje", cents: 3 },
      v4: { tipo: "total", rotulo: "d", tela: "faturas", cents: 4 },
      v5: { tipo: "total", rotulo: "e", tela: "mes", mes: "2026-08", cents: 5 },
    } as MiaReply["valores"]);
    expect(miaSources(r).map((s) => s.label)).toEqual(["Ver setembro", "Ver faturas"]);
    expect(miaSources(reply({}))).toEqual([]);
    // A difference with no month of its own adds nothing beside the month already named.
    const diff = reply({
      v1: { tipo: "total", rotulo: "a", tela: "mes", mes: "2026-09", cents: 1 },
      v2: { tipo: "diferenca", rotulo: "b", tela: "mes", cents: -2 },
    } as MiaReply["valores"]);
    expect(miaSources(diff).map((s) => s.label)).toEqual(["Ver setembro"]);
    // Two Septembers say which year each one is.
    const years = reply({
      v1: { tipo: "total", rotulo: "a", tela: "mes", mes: "2026-09", cents: 1 },
      v2: { tipo: "total", rotulo: "b", tela: "mes", mes: "2025-09", cents: 2 },
    } as MiaReply["valores"]);
    expect(miaSources(years).map((s) => s.label)).toEqual([
      "Ver setembro de 2026",
      "Ver setembro de 2025",
    ]);
  });

  it("starts with five questions, those about the screen she was opened from first", () => {
    const faturas = miaStarters("faturas");
    expect(faturas.slice(0, 2)).toEqual([
      "Quanto vem nas próximas faturas?",
      "Qual fatura está mais alta?",
    ]);
    expect(faturas).toHaveLength(5);
    expect(new Set(faturas).size).toBe(5);
    expect(miaStarters()[0]).toBe("Quanto cabe por dia?");
  });

  it("suggests two questions not asked yet", () => {
    expect(miaNext(["Quanto cabe por dia?"])).toEqual([
      "Como está minha reserva?",
      "Quanto vem nas próximas faturas?",
    ]);
    const all = [...miaStarters("hoje"), ...miaStarters("faturas"), ...miaStarters("mes")];
    expect(miaNext(all)).toEqual([]);
  });

  it("says more as the wait goes on", () => {
    expect(miaWaiting(0)).toBe("A Mia está lendo a planilha…");
    expect(miaWaiting(8)).toBe("Fazendo as contas…");
    expect(miaWaiting(30)).toMatch(/um minuto/);
  });
});
