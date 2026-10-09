import { describe, expect, it } from "vitest";
import { type CardConfig, cents, localDate, placeEntry } from "../src/index.ts";

const card = (name: string, closingDay: number, dueDay: number): CardConfig => ({
  name,
  closingDay,
  dueDay,
  closingEstimated: false,
});
const cards = [card("Banco A", 29, 12), card("Banco B", 3, 13), card("Banco C", 25, 2)];
const d = localDate;

describe("placeEntry", () => {
  it("puts an income line on the Entrada of its day, with no section", () => {
    expect(
      placeEntry(
        { kind: "entrada", amount: cents(601273), description: "Salário", date: d("2026-10-29") },
        cards,
      ),
    ).toEqual([
      {
        date: "2026-10-29",
        column: "entrada",
        section: null,
        amount: 601273,
        description: "Salário",
        target: "line",
      },
    ]);
  });

  it("puts Pix, debit and cash on the Diário of the day, never on Saída", () => {
    const [p] = placeEntry(
      { kind: "diario", amount: cents(4240), description: "Restaurante", date: d("2026-10-09") },
      cards,
    );
    expect(p).toMatchObject({ date: "2026-10-09", column: "diario", section: null });
  });

  it("puts bills under CONTAS, investments under Investimento and the reserve under Reserva on the Saída of the day", () => {
    const conta = placeEntry(
      { kind: "conta", amount: cents(21543), description: "Luz", date: d("2026-11-11") },
      cards,
    );
    const inv = placeEntry(
      {
        kind: "investimento",
        amount: cents(30639),
        description: "Previdência",
        date: d("2026-11-27"),
      },
      cards,
    );
    expect(conta[0]).toMatchObject({ column: "saida", section: "contas", target: "line" });
    expect(inv[0]).toMatchObject({ column: "saida", section: "investimento", target: "line" });
    const res = placeEntry(
      { kind: "reserva", amount: cents(50000), description: "Reserva", date: d("2026-11-27") },
      cards,
    );
    expect(res[0]).toMatchObject({ column: "saida", section: "reserva", target: "line" });
  });

  it("adds a card purchase to the card's line on the due date of the bill it falls in", () => {
    // Closing 29, due 12: bought on 9/10 → closes 29/10 → due 12/11.
    const [p] = placeEntry(
      {
        kind: "cartao",
        amount: cents(4240),
        description: "Restaurante",
        date: d("2026-10-09"),
        card: "Banco A",
      },
      cards,
    );
    expect(p).toEqual({
      date: "2026-11-12",
      column: "saida",
      section: "cartoes",
      amount: 4240,
      description: "Banco A",
      target: "card",
    });
  });

  it("sends a purchase made after the closing day to the next bill", () => {
    const due = (date: string, name: string) =>
      placeEntry(
        { kind: "cartao", amount: cents(100), description: "x", date: d(date), card: name },
        cards,
      )[0]?.date;
    expect(due("2026-10-29", "Banco A")).toBe("2026-11-12");
    expect(due("2026-10-30", "Banco A")).toBe("2026-12-12");
    expect(due("2026-10-03", "Banco B")).toBe("2026-10-13");
    expect(due("2026-10-04", "Banco B")).toBe("2026-11-13");
    // Due day before the closing day: closes 25/10, due 2/11.
    expect(due("2026-10-20", "Banco C")).toBe("2026-11-02");
    expect(due("2026-10-26", "Banco C")).toBe("2026-12-02");
  });

  it("spreads installments over the next bills, the extra cents on the first one", () => {
    const ps = placeEntry(
      {
        kind: "cartao",
        amount: cents(10000),
        description: "Fone",
        date: d("2026-12-30"),
        card: "Banco A",
        installments: 3,
      },
      cards,
    );
    expect(ps.map((p) => [p.date, p.amount])).toEqual([
      ["2027-02-12", 3334],
      ["2027-03-12", 3333],
      ["2027-04-12", 3333],
    ]);
  });

  it("matches the card name ignoring case and accents, and keeps the configured spelling", () => {
    const [p] = placeEntry(
      {
        kind: "cartao",
        amount: cents(1),
        description: "x",
        date: d("2026-10-09"),
        card: "banco a",
      },
      cards,
    );
    expect(p?.description).toBe("Banco A");
  });

  it("refuses what the sheet cannot hold", () => {
    const base = { amount: cents(100), description: "x", date: d("2026-10-09") };
    expect(() => placeEntry({ ...base, kind: "entrada", amount: cents(0) }, cards)).toThrow();
    expect(() => placeEntry({ ...base, kind: "entrada", amount: cents(-5) }, cards)).toThrow();
    expect(() => placeEntry({ ...base, kind: "entrada", description: "  " }, cards)).toThrow();
    expect(() => placeEntry({ ...base, kind: "cartao" }, cards)).toThrow(/cartão/);
    expect(() => placeEntry({ ...base, kind: "cartao", card: "Banco Z" }, cards)).toThrow(
      /Banco Z/,
    );
    expect(() => placeEntry({ ...base, kind: "conta", installments: 2 }, cards)).toThrow();
    expect(() =>
      placeEntry({ ...base, kind: "cartao", card: "Banco A", installments: 25 }, cards),
    ).toThrow();
  });

  it("refuses a card whose closing day was only guessed", () => {
    const guessed = [{ ...card("Banco A", 5, 12), closingEstimated: true }];
    expect(() =>
      placeEntry(
        {
          kind: "cartao",
          amount: cents(100),
          description: "x",
          date: d("2026-10-09"),
          card: "Banco A",
        },
        guessed,
      ),
    ).toThrow(/fechamento/);
  });
});
