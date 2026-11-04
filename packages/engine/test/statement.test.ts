import { describe, expect, it } from "vitest";
import {
  type BankCardLine,
  billChecks,
  type CardConfig,
  cents,
  checkStatement,
  localDate,
  type StatementRead,
  withStatements,
} from "../src/index.ts";
import { cell, item, ledger } from "./builders.ts";

const holder: CardConfig = {
  name: "Visa Ana",
  closingDay: 29,
  dueDay: 12,
  closingEstimated: false,
};
const extra: CardConfig = { name: "Visa Bia", closingDay: 29, dueDay: 12, closingEstimated: false };
const line = (
  amount: number,
  billMonth: string,
  over: Partial<BankCardLine> = {},
): BankCardLine => ({
  card: "Visa Ana",
  amount: cents(amount),
  billMonth,
  description: "LOJA",
  installment: null,
  installments: null,
  ...over,
});
const sum = (ls: readonly BankCardLine[], card: string, month: string) =>
  ls.filter((l) => l.card === card && l.billMonth === month).reduce((s, l) => s + l.amount, 0);

describe("bill statement: what the bank's own bill has and the feed left out", () => {
  it("adds the second of two equal charges on one day, which the feed merged", () => {
    const feed = [
      line(7566, "2026-12", {
        card: "Visa Bia",
        description: "PET SHOP",
        date: localDate("2026-10-31"),
      }),
    ];
    const pet = (d: string) =>
      line(7566, "2026-12", { card: "Visa Bia", description: "PET SHOP", date: localDate(d) });
    const out = withStatements(feed, [
      { billMonth: "2026-12", lines: [pet("2026-10-30"), pet("2026-10-30")] },
    ]);
    expect(sum(out, "Visa Bia", "2026-12")).toBe(15132);
    expect(out.filter((l) => l.fromStatement)).toHaveLength(1);
  });

  it("adds credits the feed never sent, so the bill drops by them", () => {
    const feed = [
      line(15990, "2026-12", {
        description: "CRED EM C/C CONTESTACAO",
        date: localDate("2026-10-30"),
      }),
      line(59915, "2026-12", { date: localDate("2026-11-01") }),
    ];
    const credit = (d: string) =>
      line(-15990, "2026-12", { description: "AJUSTE A CREDITO", date: localDate(d) });
    const out = withStatements(feed, [
      {
        billMonth: "2026-12",
        lines: [
          line(15990, "2026-12", {
            description: "CRED EM C/C CONTESTACAO",
            date: localDate("2026-10-30"),
          }),
          credit("2026-10-17"),
          credit("2026-09-17"),
          line(59915, "2026-12", { date: localDate("2026-11-01") }),
        ],
      },
    ]);
    expect(sum(out, "Visa Ana", "2026-12")).toBe(59915 - 15990);
  });

  it("drops its own copy once the feed sends the line: never counted twice", () => {
    const credit = line(-15990, "2026-12", {
      description: "AJUSTE A CREDITO",
      date: localDate("2026-10-17"),
    });
    const out = withStatements([credit], [{ billMonth: "2026-12", lines: [credit] }]);
    expect(out).toEqual([credit]);
  });

  it("matches a monthly charge on its own bill, not last month's of the same value", () => {
    const music = (month: string, d: string) =>
      line(1390, month, { description: "MUSIC", date: localDate(d) });
    const feed = [music("2026-11", "2026-10-01"), music("2026-12", "2026-11-01")];
    const out = withStatements(feed, [
      { billMonth: "2026-12", lines: [music("2026-12", "2026-11-01")] },
    ]);
    expect(out).toEqual(feed);
  });

  it("takes the bill's cents on a parcel the feed rounded its own way", () => {
    // The feed has parcel 2/4 at 16,51 on Nov, so 3/4 is expected at 16,51 on Dec; the bill says 16,50.
    const feed = [line(1651, "2026-11", { description: "SHOP", installment: 2, installments: 4 })];
    const out = withStatements(feed, [
      {
        billMonth: "2026-12",
        lines: [line(1650, "2026-12", { description: "SHOP", installment: 3, installments: 4 })],
      },
    ]);
    const checks = billChecks(
      ledger("2026-11-01", 100, 0, {}),
      [holder],
      out,
      localDate("2026-11-04"),
      [],
      localDate("2026-11-01"),
    );
    // Dec counts the bill's 16,50; the last parcel on Jan keeps the feed's 16,51.
    expect(checks.map((c) => [c.due, c.bank])).toEqual([
      ["2026-11-12", 1651],
      ["2026-12-12", 1650],
      ["2027-01-12", 1651],
    ]);
    expect(out.find((l) => l.fromStatement)?.installments).toBeNull();
  });

  it("puts a charge the feed placed on the next bill back on the bill that has it", () => {
    const uber = (month: string) =>
      line(924, month, { description: "UBER", date: localDate("2026-10-28") });
    const out = withStatements(
      [uber("2026-12")],
      [{ billMonth: "2026-11", lines: [uber("2026-11")] }],
    );
    expect(sum(out, "Visa Ana", "2026-11")).toBe(924);
    expect(sum(out, "Visa Ana", "2026-12")).toBe(0);
  });

  it("makes a shared closed bill split exactly by card once its lines add up to the total", () => {
    const sheet = ledger("2026-11-01", 60, 0, {
      "2026-12-12": {
        saida: cell(10000, [item(5000, "Visa Ana"), item(5000, "Visa Bia")]),
      },
    });
    const feed = [line(5000, "2026-12"), line(5000, "2026-12", { card: "Visa Bia" })];
    const twin = line(700, "2026-12", { card: "Visa Bia", description: "RIDE" });
    const closed = [{ cards: ["Visa Ana", "Visa Bia"], billMonth: "2026-12", total: cents(10700) }];
    const today = localDate("2026-12-01");
    // Without the bill's lines the total says nothing of whose the 7,00 is.
    expect(billChecks(sheet, [holder, extra], feed, today, closed)).toEqual([]);
    const out = withStatements(feed, [
      {
        billMonth: "2026-12",
        lines: [line(5000, "2026-12"), line(5000, "2026-12", { card: "Visa Bia" }), twin],
      },
    ]);
    const checks = billChecks(sheet, [holder, extra], out, today, closed);
    expect(checks.map((c) => [c.card, c.bank, c.disagrees])).toEqual([
      ["Visa Ana", 5000, false],
      ["Visa Bia", 5700, true],
    ]);
  });
});

describe("reading a bill: every card's lines must add up to the total it prints", () => {
  const read: StatementRead = {
    due: localDate("2026-12-12"),
    closed: false,
    total: cents(688783),
    cards: [
      {
        number: "9775",
        total: cents(689641),
        previous: cents(629726),
        paid: cents(0),
        lines: [
          {
            date: localDate("2026-11-01"),
            description: "LOJA",
            amount: cents(59915),
            installment: null,
            installments: null,
          },
        ],
      },
      {
        number: "4478",
        total: cents(-15990),
        previous: cents(0),
        paid: cents(0),
        lines: [
          {
            date: localDate("2026-10-30"),
            description: "CRED",
            amount: cents(15990),
            installment: null,
            installments: null,
          },
          {
            date: localDate("2026-10-17"),
            description: "AJUSTE",
            amount: cents(-15990),
            installment: null,
            installments: null,
          },
          {
            date: localDate("2026-09-17"),
            description: "AJUSTE",
            amount: cents(-15990),
            installment: null,
            installments: null,
          },
        ],
      },
      {
        number: "3152",
        total: cents(15132),
        previous: cents(0),
        paid: cents(0),
        lines: [
          {
            date: localDate("2026-10-30"),
            description: "PET",
            amount: cents(7566),
            installment: null,
            installments: null,
          },
          {
            date: localDate("2026-10-30"),
            description: "PET",
            amount: cents(7566),
            installment: null,
            installments: null,
          },
        ],
      },
    ],
    scheduled: [],
  };

  it("accepts a bill whose cards add up", () => {
    expect(checkStatement(read)).toEqual([]);
  });

  it("names the card whose lines do not add up, and by how much", () => {
    const [first, second, third] = read.cards;
    if (!first || !second || !third) throw new Error("fixture");
    const short = { ...read, cards: [first, second, { ...third, lines: third.lines.slice(1) }] };
    expect(checkStatement(short)).toEqual([{ card: "3152", printed: 15132, read: 7566 }]);
  });

  it("checks the whole bill against the sum of its cards", () => {
    expect(checkStatement({ ...read, total: cents(688784) })).toEqual([
      { card: null, printed: 688784, read: 688783 },
    ]);
  });
});
