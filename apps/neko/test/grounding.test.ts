import { describe, expect, it } from "vitest";
import {
  checkText,
  type Seen,
  seenValue,
  seeText,
  seeToolResult,
} from "../src/worker/grounding.ts";

const fresh = (): Seen => new Map();

describe("grounding", () => {
  it("accepts values a tool gave, with the screen and month they came from", () => {
    const seen = fresh();
    seeToolResult(
      seen,
      "resumo_meses",
      { de: "2026-09", ate: "2026-10" },
      JSON.stringify({
        meses: [
          { mes: "2026-09", saidas: 4321.5, resultado: -812.07 },
          { mes: "2026-10", saidas: 3900 },
        ],
      }),
    );
    const out = checkText(seen, "Em setembro saíram R$ 4.321,50 e o mês fechou em −R$ 812,07.");
    expect(out).toEqual([
      { texto: "R$ 4.321,50", conferido: true, tela: "mes", mes: "2026-09" },
      { texto: "−R$ 812,07", conferido: true, tela: "mes", mes: "2026-09" },
    ]);
  });

  it("takes the asked month when the answer does not name one", () => {
    const seen = fresh();
    seeToolResult(seen, "mes", { mes: "2026-08" }, JSON.stringify({ entradas: 7384.07 }));
    expect(checkText(seen, "Entraram R$ 7.384,07.")[0]).toMatchObject({
      conferido: true,
      tela: "mes",
      mes: "2026-08",
    });
  });

  it("allows whole reais rounded or cut from a checked value, never other cents", () => {
    const seen = fresh();
    seeToolResult(seen, "faturas", {}, JSON.stringify({ total: 4939.62 }));
    expect(checkText(seen, "Cerca de R$ 4.940 nas faturas.")[0]?.conferido).toBe(true);
    expect(checkText(seen, "Cerca de R$ 4.939 nas faturas.")[0]?.conferido).toBe(true);
    expect(checkText(seen, "Exatos R$ 4.939,60.")[0]?.conferido).toBe(false);
    expect(checkText(seen, "Uns R$ 5.000.")[0]?.conferido).toBe(false);
  });

  it("accepts code output in plain or Brazilian form, and the owner's own numbers", () => {
    const seen = fresh();
    seeText(seen, "media 1234.5\ntotal 10,234.75");
    seeText(seen, "Posso comprar uma TV de R$ 2.000 em 10x?");
    const out = checkText(seen, "A média foi R$ 1.234,50, o total R$ 10.234,75 e a TV R$ 2.000.");
    expect(out.every((v) => v.conferido)).toBe(true);
    expect(out[0]).not.toHaveProperty("tela");
  });

  it("marks a value no tool gave", () => {
    const seen = fresh();
    seeToolResult(seen, "hoje", {}, JSON.stringify({ saldo_hoje: 1500 }));
    expect(checkText(seen, "Você tem R$ 1.500 hoje e deve gastar R$ 320,00 por semana.")).toEqual([
      { texto: "R$ 1.500", conferido: true, tela: "hoje" },
      { texto: "R$ 320,00", conferido: false },
    ]);
  });

  it("reads every way she may write money, once each", () => {
    const seen = fresh();
    const out = checkText(seen, "R$1.234, R$ -300, −R$ 12345,6 e de novo R$1.234.");
    expect(out.map((v) => v.texto)).toEqual(["R$1.234", "R$ -300", "−R$ 12345,6"]);
  });

  it("checks chart values with the same allowance", () => {
    const seen = fresh();
    seeToolResult(seen, "mes", {}, JSON.stringify({ saidas: 3999.9 }));
    expect(seenValue(seen, 3999.9)).toBe(true);
    expect(seenValue(seen, 4000)).toBe(true);
    expect(seenValue(seen, 3999.5)).toBe(false);
  });
});
