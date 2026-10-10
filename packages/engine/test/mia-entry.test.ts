import { describe, expect, it } from "vitest";
import { entryFromMia, localDate } from "../src/index.ts";

const today = localDate("2026-10-10");
const cards = ["Nubank", "Bradesco João"];
const said = (over: Record<string, unknown> = {}) => ({
  tipo: "pix",
  valor: 45.9,
  dia: "2026-10-10",
  nome: "Padaria",
  cartao: "",
  parcelas: 1,
  ...over,
});

describe("entryFromMia", () => {
  it("turns a Pix sentence into a Diário entry", () => {
    expect(entryFromMia(said(), today, cards)).toEqual({
      kind: "diario",
      amount: 4590,
      date: "2026-10-10",
      description: "Padaria",
    });
  });

  it("keeps the card and its parcels only for a card the owner has", () => {
    expect(
      entryFromMia(said({ tipo: "cartao", cartao: "nubank", parcelas: 3 }), today, cards),
    ).toMatchObject({ kind: "cartao", card: "Nubank", installments: 3 });
    // An unknown card leaves the way of paying for the owner to pick.
    const unknown = entryFromMia(said({ tipo: "cartao", cartao: "Visa" }), today, cards);
    expect(unknown).not.toHaveProperty("kind");
    expect(unknown).not.toHaveProperty("card");
    expect(unknown).toMatchObject({ amount: 4590 });
  });

  it("maps entrada and conta, and rounds the value to cents", () => {
    expect(entryFromMia(said({ tipo: "entrada", valor: 3200 }), today, cards)).toMatchObject({
      kind: "entrada",
      amount: 320000,
    });
    expect(entryFromMia(said({ tipo: "conta", valor: 0.1 + 0.2 }), today, cards)).toMatchObject({
      kind: "conta",
      amount: 30,
    });
  });

  it("drops what it cannot trust and keeps the rest", () => {
    const out = entryFromMia(
      said({ valor: -5, dia: "2026-02-30", nome: "   ", parcelas: 99 }),
      today,
      cards,
    );
    expect(out).toEqual({ kind: "diario" });
    // A day more than a year away is a misheard date, not a plan.
    expect(entryFromMia(said({ dia: "2030-01-01" }), today, cards)).not.toHaveProperty("date");
    expect(entryFromMia(said({ nome: "x".repeat(200) }), today, cards)?.description).toHaveLength(
      80,
    );
  });

  it("returns nothing when Mia did not understand or the input is not hers", () => {
    expect(entryFromMia(said({ tipo: "nao_entendi" }), today, cards)).toBeNull();
    expect(entryFromMia({ valor: "muito" }, today, cards)).toBeNull();
    expect(entryFromMia(null, today, cards)).toBeNull();
    // An unknown card and no value leave nothing worth filling.
    expect(
      entryFromMia(said({ tipo: "cartao", cartao: "Visa", valor: 0 }), today, cards),
    ).toBeNull();
  });
});
