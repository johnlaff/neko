import { describe, expect, it } from "vitest";
import {
  type BankCardLine,
  cardsBillSpend,
  cents,
  localDate,
  subscriptionNews,
  subscriptions,
} from "../src/index.ts";

const today = localDate("2026-10-19");
const line = (
  date: string,
  description: string,
  amount: number,
  extra: Partial<BankCardLine> = {},
) =>
  ({
    card: "Cartão Azul",
    amount: cents(amount),
    billMonth: date.slice(0, 7),
    description,
    installment: null,
    installments: null,
    date: localDate(date),
    ...extra,
  }) satisfies BankCardLine;

describe("subscriptions", () => {
  it("finds a charge of the same value that comes back each month", () => {
    const r = subscriptions(
      [
        line("2026-08-06", "EBN*SPOTIFY", 23_90),
        line("2026-09-06", "EBN*SPOTIFY", 23_90),
        line("2026-10-06", "EBN  *SPOTIFY", 23_90),
      ],
      today,
      [],
    );
    expect(r).toEqual({
      total: 23_90,
      items: [
        {
          key: "spotify|2390",
          description: "EBN  *SPOTIFY",
          card: "Cartão Azul",
          amount: 23_90,
          last: "2026-10-06",
          charges: 3,
          twin: false,
        },
      ],
    });
  });

  it("leaves out one-off purchases, parcels, refunds, fees and charges a month apart by chance with another value", () => {
    const r = subscriptions(
      [
        line("2026-08-20", "OUTBACK", 196_00),
        line("2026-09-20", "OUTBACK", 135_34),
        line("2026-08-11", "AMAZON PRIME BR", 13_90, { installment: 3, installments: 12 }),
        line("2026-09-11", "AMAZON PRIME BR", 13_90, { installment: 4, installments: 12 }),
        line("2026-08-11", "IOF S/ TRANS INTER REAIS", 19_25),
        line("2026-09-11", "IOF S/ TRANS INTER REAIS", 19_25),
        line("2026-08-14", "ESTORNO LOJA", -50_00),
        line("2026-09-14", "ESTORNO LOJA", -50_00),
        line("2026-10-01", "LOJA NOVA", 80_00),
      ],
      today,
      [],
    );
    expect(r.items).toEqual([]);
  });

  it("drops one that stopped coming, and the cards someone else pays", () => {
    const r = subscriptions(
      [
        line("2026-07-01", "NETFLIX", 44_90),
        line("2026-08-01", "NETFLIX", 44_90),
        line("2026-09-04", "TOTALPASS", 99_90, { card: "Cartão da Ana" }),
        line("2026-10-04", "TOTALPASS", 99_90, { card: "Cartão da Ana" }),
      ],
      today,
      ["Cartão da Ana"],
    );
    expect(r.items).toEqual([]);
  });

  it("keeps two plans of the same store apart and says there are two, the biggest first", () => {
    const r = subscriptions(
      [
        line("2026-08-27", "TOTALPASS", 139_90),
        line("2026-09-04", "TOTALPASS", 119_90),
        line("2026-09-27", "TOTALPASS", 139_90),
        line("2026-10-04", "TOTALPASS", 119_90),
        line("2026-09-07", "Amazon Prime Canais", 29_90),
        line("2026-10-07", "Amazon Prime Canais", 29_90),
      ],
      today,
      [],
    );
    expect(r.items.map((i) => [i.key, i.amount, i.twin])).toEqual([
      ["totalpass|13990", 139_90, true],
      ["totalpass|11990", 119_90, true],
      ["amazonprimecanais|2990", 29_90, false],
    ]);
    expect(r.total).toBe(289_70);
    // Two channels of the same price: two plans, each with its own key.
    const two = subscriptions(
      [
        line("2026-09-01", "Amazon Prime Canais", 29_90),
        line("2026-09-15", "Amazon Prime Canais", 29_90),
        line("2026-10-01", "Amazon Prime Canais", 29_90),
        line("2026-10-15", "Amazon Prime Canais", 29_90),
      ],
      today,
      [],
    );
    expect(two.items.map((i) => i.key)).toEqual([
      "amazonprimecanais|2990",
      "amazonprimecanais|2990#2",
    ]);
  });

  it("needs the charges about a month apart", () => {
    const r = subscriptions(
      [line("2026-09-01", "ACADEMIA", 100_00), line("2026-09-15", "ACADEMIA", 100_00)],
      today,
      [],
    );
    expect(r.items).toEqual([]);
  });
});

describe("subscriptionNews", () => {
  it("says a new subscription on its second charge, while it is news", () => {
    const lines = [
      line("2026-09-17", "SUA ACADEMIA", 159_90),
      line("2026-10-17", "SUA ACADEMIA", 159_90),
      // Running for months: not news.
      line("2026-07-06", "EBN*SPOTIFY", 23_90),
      line("2026-08-06", "EBN*SPOTIFY", 23_90),
      line("2026-09-06", "EBN*SPOTIFY", 23_90),
      line("2026-10-06", "EBN*SPOTIFY", 23_90),
    ];
    expect(subscriptionNews(lines, today, [])).toEqual([
      {
        kind: "nova",
        key: "nova|suaacademia|15990|cartao azul",
        description: "SUA ACADEMIA",
        card: "Cartão Azul",
        amount: 159_90,
        before: null,
        since: "2026-09-17",
        date: "2026-10-17",
      },
    ]);
    // A week on, it is old news.
    expect(subscriptionNews(lines, localDate("2026-10-25"), [])).toEqual([]);
  });

  it("says a subscription went up when the next charge comes higher", () => {
    const r = subscriptionNews(
      [
        line("2026-07-15", "NETFLIX.COM", 39_90),
        line("2026-08-15", "NETFLIX.COM", 39_90),
        line("2026-09-15", "NETFLIX.COM", 39_90),
        line("2026-10-15", "NETFLIX.COM", 44_90),
        // Down is not news, nor another card's plan of the same store.
        line("2026-08-10", "YOUTUBEPREMIUM", 26_90),
        line("2026-09-10", "YOUTUBEPREMIUM", 26_90),
        line("2026-10-10", "YOUTUBEPREMIUM", 20_90),
        line("2026-08-12", "TOTALPASS", 99_90, { card: "Cartão Verde" }),
        line("2026-09-12", "TOTALPASS", 99_90, { card: "Cartão Verde" }),
        line("2026-10-12", "TOTALPASS", 99_90, { card: "Cartão Verde" }),
        line("2026-10-14", "TOTALPASS", 139_90),
      ],
      today,
      [],
    );
    expect(r).toEqual([
      {
        kind: "subiu",
        key: "subiu|netflixcom|4490|cartao azul",
        description: "NETFLIX.COM",
        card: "Cartão Azul",
        amount: 44_90,
        before: 39_90,
        since: "2026-07-15",
        date: "2026-10-15",
      },
    ]);
  });

  it("leaves out someone else's cards, one-off purchases and a higher bill a month apart by chance", () => {
    const r = subscriptionNews(
      [
        line("2026-09-17", "NOVA ACADEMIA", 120_00, { card: "Cartão da Ana" }),
        line("2026-10-17", "NOVA ACADEMIA", 120_00, { card: "Cartão da Ana" }),
        line("2026-09-15", "OUTBACK", 135_34),
        line("2026-10-15", "OUTBACK", 196_00),
      ],
      today,
      ["Cartão da Ana"],
    );
    expect(r).toEqual([]);
  });
});

describe("cardsBillSpend", () => {
  it("adds what the owner's bills due that month hold: purchases, parcels and subscriptions", () => {
    const lines = [
      line("2026-10-06", "EBN*SPOTIFY", 23_90, { billMonth: "2026-11" }),
      line("2026-10-02", "PADARIA", 30_00, { billMonth: "2026-11" }),
      line("2026-09-03", "SOFA PARC 02/05", 300_00, {
        installment: 2,
        installments: 5,
        billMonth: "2026-11",
      }),
      line("2026-10-04", "LIVRARIA", 80_00, { card: "Cartão Verde", billMonth: "2026-11" }),
      line("2026-10-13", "PAGTO. POR DEB EM C/C", -500_00, { billMonth: "2026-11" }),
      line("2026-09-20", "MERCADO", 100_00, { billMonth: "2026-10" }),
    ];
    expect(cardsBillSpend(lines, "2026-11", ["Cartão Verde"])).toBe(353_90);
  });

  it("counts the parcels the bank lists only when the bill closes", () => {
    // Parcel 4/12 is on October's bill; 5/12 is owed on November's before the bank lists it.
    const lines = [
      line("2026-07-03", "LOJA DE MOVEIS", 88_02, {
        installment: 4,
        installments: 12,
        billMonth: "2026-10",
      }),
      line("2026-10-06", "PADARIA", 30_00, { billMonth: "2026-11" }),
    ];
    expect(cardsBillSpend(lines, "2026-11", [])).toBe(118_02);
  });

  it("does not count a parcel twice once the bank lists it", () => {
    const lines = [
      line("2026-07-03", "LOJA DE MOVEIS", 88_02, {
        installment: 4,
        installments: 12,
        billMonth: "2026-10",
      }),
      line("2026-07-03", "LOJA DE MOVEIS", 88_02, {
        installment: 5,
        installments: 12,
        billMonth: "2026-11",
      }),
    ];
    expect(cardsBillSpend(lines, "2026-11", [])).toBe(88_02);
  });
});
