import { describe, expect, it } from "vitest";
import {
  type BankCardLine,
  cardsBillSpend,
  cents,
  localDate,
  markOf,
  owedOnBills,
  ownerKey,
  ownerOf,
} from "../src/index.ts";

const line = (
  date: string,
  description: string,
  amount: number,
  extra: Partial<BankCardLine> = {},
) =>
  ({
    card: "Cartão Azul",
    amount: cents(amount),
    billMonth: "2026-11",
    description,
    installment: null,
    installments: null,
    date: localDate(date),
    ...extra,
  }) satisfies BankCardLine;

const plan = (n: number, billMonth: string) =>
  line("2026-09-24", `ESTUDIO SOFT ${String(n).padStart(2, "0")}/12`, 150_00, {
    installment: n,
    installments: 12,
    billMonth,
  });

describe("ownerKey", () => {
  it("marks a whole plan of parcels with one key, whatever the parcel", () => {
    expect(ownerKey(plan(2, "2026-11"))).toBe(ownerKey(plan(3, "2026-12")));
    expect(ownerKey(plan(2, "2026-11"))).toBe("cartao azul|estudiosoft|15000|12x");
  });

  it("marks a single purchase by its day, so the next one at the same store stays the owner's", () => {
    const a = line("2026-10-03", "PG *LIVRARIA", 80_00);
    expect(ownerKey(a)).toBe("cartao azul|livraria|8000|2026-10-03");
    expect(ownerKey({ ...a, date: localDate("2026-10-20") })).not.toBe(ownerKey(a));
  });

  it("has nothing to mark on a refund or an old line with no day", () => {
    expect(ownerKey(line("2026-10-03", "ESTORNO LIVRARIA", -80_00))).toBeNull();
    const { date: _, ...old } = line("2026-10-03", "LIVRARIA", 80_00);
    expect(ownerKey(old)).toBeNull();
  });
});

describe("owedOnBills", () => {
  const marks = [
    { key: "cartao azul|estudiosoft|15000|12x", person: "Bia" },
    { key: "cartao azul|livraria|8000|2026-10-03", person: "Rafa" },
  ];
  const lines = [
    plan(2, "2026-11"),
    plan(3, "2026-12"),
    line("2026-10-03", "LIVRARIA", 80_00),
    line("2026-10-05", "PADARIA", 30_00),
  ];

  it("adds each person's lines on the month's bills, with their parcels still to come", () => {
    const owed = owedOnBills(lines, "2026-11", marks);
    expect(owed.map(({ items: _, ...o }) => o)).toEqual([
      { person: "Bia", total: 150_00, later: 1500_00, lines: 1 },
      { person: "Rafa", total: 80_00, later: 0, lines: 1 },
    ]);
    // Each purchase says where it is: the card, the day, the parcel and what is still to come.
    expect(owed[0]?.items).toEqual([
      {
        card: "Cartão Azul",
        description: "ESTUDIO SOFT 02/12",
        amount: 150_00,
        date: "2026-09-24",
        installment: 2,
        installments: 12,
        later: 1500_00,
      },
    ]);
    expect(ownerOf(lines[3] as BankCardLine, marks)).toBeNull();
  });

  it("leaves what is someone else's out of the ceiling", () => {
    expect(cardsBillSpend(lines, "2026-11", [], marks)).toBe(30_00);
    expect(cardsBillSpend(lines, "2026-11", [])).toBe(260_00);
  });
});

describe("markOf", () => {
  // The first parcel carries the bank's rounding: 238,77, then 238,71 on every later bill.
  const first = line("2026-09-25", "GRAPHISOFT 01/12", 238_77, {
    installment: 1,
    installments: 12,
    billMonth: "2026-11",
  });
  const later = line("2026-09-25", "GRAPHISOFT 02/12", 238_71, {
    installment: 2,
    installments: 12,
    billMonth: "2026-12",
  });
  const gio = [{ key: ownerKey(first) ?? "", person: "Gio" }];

  it("follows a plan marked on its first parcel to the later ones", () => {
    expect(markOf(later, gio)).toEqual(gio[0]);
    expect(ownerOf(later, gio)).toBe("Gio");
    expect(cardsBillSpend([first, later], "2026-12", [], gio)).toBe(0);
  });

  it("keeps another plan of the same store apart", () => {
    const other = line("2026-09-25", "GRAPHISOFT 02/12", 99_90, {
      installment: 2,
      installments: 12,
      billMonth: "2026-12",
    });
    const sixTimes = line("2026-09-25", "GRAPHISOFT 02/06", 238_71, {
      installment: 2,
      installments: 6,
      billMonth: "2026-12",
    });
    expect(markOf(other, gio)).toBeNull();
    expect(markOf(sixTimes, gio)).toBeNull();
  });

  it("matches a single charge only by its own key", () => {
    const coffee = line("2026-10-02", "PADARIA", 30_00);
    const marks = [{ key: ownerKey(coffee) ?? "", person: "Gio" }];
    expect(markOf(line("2026-10-02", "PADARIA", 30_01), marks)).toBeNull();
    expect(markOf(coffee, marks)).toEqual(marks[0]);
  });
});
