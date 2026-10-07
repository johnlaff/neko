import { describe, expect, it } from "vitest";
import { parseCeilingNote, parseNote } from "../src/index.ts";

describe("parseNote", () => {
  it("reads value and description lines", () => {
    expect(parseNote("R$ 150,00 - Categoria A\nR$ 200,50 - Categoria B").items).toEqual([
      { amount: 15000, description: "Categoria A", section: null },
      { amount: 20050, description: "Categoria B", section: null },
    ]);
  });
  it("tolerates spacing and keeps dashes inside the description", () => {
    expect(parseNote("R$300,00 - Item").items[0]?.amount).toBe(30000);
    expect(parseNote("R$ 50,00-Descrição do item").items[0]?.description).toBe("Descrição do item");
    expect(parseNote("R$ 80,00 - Produto A - loja B").items[0]?.description).toBe(
      "Produto A - loja B",
    );
  });
  it("tracks sections across blank lines and treats other text as headers", () => {
    const n = parseNote(
      "CONTAS:\nR$ 100,00 - Item A\n\nCARTÕES:\nR$ 200,00 - Item B\nTotal = R$ 300,00",
    );
    expect(n.items.map((i) => i.section)).toEqual(["contas", "cartoes"]);
    expect(n.unparsed).toEqual([]);
  });
  it("keeps zero placeholders and reports lines it cannot read", () => {
    const n = parseNote("CARTÕES:\nR$ 0,00 - Banco A\nR$ 150,00 - Banco B\nR$ abc - lixo\nR$ -50");
    expect(n.items.map((i) => [i.amount, i.description])).toEqual([
      [0, "Banco A"],
      [15000, "Banco B"],
    ]);
    expect(n.unparsed).toEqual(["R$ abc - lixo", "R$ -50"]);
  });
  it("keeps #tags in the description for later rules", () => {
    expect(
      parseNote("R$ 530,00 - Cartões Pessoa B #reembolso:Pessoa B").items[0]?.description,
    ).toBe("Cartões Pessoa B #reembolso:Pessoa B");
  });
});

describe("parseCeilingNote", () => {
  const REAL_SHAPE =
    "Mensal\tR$ 300,00\tTransporte\nMensal\tR$ 200,00\tFarmácia\nMensal\tR$ 300,00\tAlimentação\nMensal\tR$ 200,00\tLazer\nMensal\tR$ 250,00\tCompras\n\nTotal = R$ 1250,00\n\nR$ 1250,00 / 31 Dias = R$ 40,33";
  it("reads the planned daily spend", () => {
    expect(parseCeilingNote(REAL_SHAPE)).toEqual({ perDay: 4033, total: 125000, days: 31 });
    expect(parseCeilingNote("R$ 900,00 / 30 dias = R$ 30,00")?.perDay).toBe(3000);
    expect(
      parseCeilingNote("previsão do diário\nR$ 600,00 / 30 Dias = R$ 20,00\nrevisar em julho")
        ?.perDay,
    ).toBe(2000);
  });
  it("rejects inconsistent notes", () => {
    expect(parseCeilingNote("R$ 1250,00 / 31 Dias = R$ 41,00")).toBeNull();
    expect(parseCeilingNote("R$ 0,00 / 31 Dias = R$ 0,00")).toBeNull();
    expect(parseCeilingNote("R$ 100,00 - mercado")).toBeNull();
  });
});
