import { describe, expect, it } from "vitest";
import { bankText, closesIn } from "../src/web/format.ts";

describe("closesIn", () => {
  it("counts today in closesInDays: 1 is today, 2 tomorrow", () => {
    expect(closesIn(1)).toBe("Fecha hoje");
    expect(closesIn(2)).toBe("Fecha amanhã");
    expect(closesIn(4)).toBe("Fecha em 3 dias");
  });
});

describe("bankText", () => {
  it("reads a bank's capitals as a name, keeping small words and codes", () => {
    expect(bankText("PIX FEIRA DO BAIRRO")).toBe("Pix Feira do Bairro");
    expect(bankText("PIX RECEBIDO ANA")).toBe("Pix Recebido Ana");
    expect(bankText("PAG*LOJA 123 SÃO PAULO")).toBe("Pag*loja 123 São Paulo");
  });

  it("leaves text that already has lowercase as sent", () => {
    expect(bankText("Uber *Trip")).toBe("Uber *Trip");
  });
});
