import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CATEGORIES, categoryOf } from "../src/shared/categories.ts";

/** Descriptions as people write them in the sheet, and the kind each one is. */
const CASES: Record<string, string | null> = {
  Aluguel: "casa",
  Condomínio: "casa",
  Uniube: "estudo",
  "Inglês Wizard": "estudo",
  "Academia e curso": "estudo",
  Eletricidade: "luz",
  "Conta de luz": "luz",
  "Água/Esgoto": "agua",
  Internet: "internet",
  "Celular Vivo": "celular",
  Salário: "salario",
  "13º salário": "salario",
  Poupança: "poupanca",
  "Plano de saúde": "saude",
  Farmácia: "saude",
  "Smart Fit": "academia",
  Gasolina: "transporte",
  IPVA: "transporte",
  "Financiamento do carro": "transporte",
  Supermercado: "mercado",
  iFood: "comida",
  Netflix: "assinatura",
  "Ração dos gatos": "pet",
  DARF: "imposto",
  "Seguro de vida": "seguro",
  "Passagem aérea": "viagem",
  Barbearia: "beleza",
  // Whole words only, and no guess for a line that names nothing known.
  Luzia: null,
  "Pix Recebido Ana": null,
  Diversos: null,
  "": null,
};

describe("categoryOf", () => {
  it.each(Object.entries(CASES))("%s → %s", (text, slug) => {
    expect(categoryOf(text)?.slug ?? null).toBe(slug);
  });

  it("draws every kind as one path on the 24px grid", () => {
    for (const c of CATEGORIES) expect(c.icon).toMatch(/^M[\d.\s,a-zA-Z-]+$/);
    expect(new Set(CATEGORIES.map((c) => c.slug)).size).toBe(CATEGORIES.length);
  });
});

/**
 * The Android app matches descriptions on its own (ui/Categories.kt); it reads this table and
 * these cases in its unit tests so both sides draw the same icon. UPDATE_CONTRACT=1 rewrites it.
 */
describe("android contract", () => {
  it("matches the category table and the cases", () => {
    const path = join(import.meta.dirname, "../../android/app/src/test/resources/categories.json");
    const contract = {
      categories: CATEGORIES.map(({ slug, words, icon }) => ({ slug, words, icon })),
      cases: CASES,
    };
    if (process.env.UPDATE_CONTRACT) writeFileSync(path, `${JSON.stringify(contract, null, 2)}\n`);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(contract);
  });
});
