import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INSTITUTIONS, institutionOf } from "../src/shared/institutions.ts";
import { BANK_MARKS } from "../src/web/bankMarks.ts";

/** Card names as people write them in the sheet, and the bank each one is. */
const CASES: Record<string, string | null> = {
  Itaú: "itau",
  "Itaucard Platinum": "itau",
  "Mercado Pago": "mercadopago",
  Nubank: "nubank",
  "Nu Ultravioleta": "nubank",
  Inter: "inter",
  "Banco Inter": "inter",
  Bradesco: "bradesco",
  "Bradesco Elo": "bradesco",
  // Issued by Bradescard, and still Amazon's card.
  "Amazon Bradescard": "amazon",
  Amazon: "amazon",
  "BB Ourocard": "bancodobrasil",
  "C6 Carbon": "c6bank",
  XP: "xp",
  // Whole words only: these merely contain a bank's short name.
  Internet: null,
  Nuvem: null,
  "Cartão Azul": null,
  "": null,
};

describe("institutionOf", () => {
  it.each(Object.entries(CASES))("%s → %s", (name, slug) => {
    expect(institutionOf(name)?.slug ?? null).toBe(slug);
  });

  it("has a mark for every bank", () => {
    for (const i of INSTITUTIONS) expect(BANK_MARKS[i.slug]?.d).toMatch(/^M/);
  });
});

/**
 * The Android app matches card names on its own (ui/Institutions.kt); it reads these cases in its
 * unit tests so both sides pick the same bank. UPDATE_CONTRACT=1 rewrites the file.
 */
describe("android contract", () => {
  it("matches the bank table and the cases", () => {
    const path = join(
      import.meta.dirname,
      "../../android/app/src/test/resources/institutions.json",
    );
    const contract = {
      institutions: INSTITUTIONS.map(({ slug, words, bg, fg }) => ({ slug, words, bg, fg })),
      cases: CASES,
    };
    if (process.env.UPDATE_CONTRACT) writeFileSync(path, `${JSON.stringify(contract, null, 2)}\n`);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(contract);
  });
});
