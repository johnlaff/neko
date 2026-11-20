import { describe, expect, it } from "vitest";
import {
  type BankCardLine,
  cardsBillSpend,
  cents,
  chargedAgainNews,
  localDate,
  subscriptionList,
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
          charged: [
            { date: "2026-08-06", amount: 23_90 },
            { date: "2026-09-06", amount: 23_90 },
            { date: "2026-10-06", amount: 23_90 },
          ],
          before: null,
          isNew: false,
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
        line("2026-09-04", "CLUBE FIT", 89_90, { card: "Cartão da Ana" }),
        line("2026-10-04", "CLUBE FIT", 89_90, { card: "Cartão da Ana" }),
      ],
      today,
      ["Cartão da Ana"],
    );
    expect(r.items).toEqual([]);
  });

  it("keeps two plans of the same store apart and says there are two, the biggest first", () => {
    const r = subscriptions(
      [
        line("2026-08-27", "CLUBE FIT", 129_90),
        line("2026-09-04", "CLUBE FIT", 109_90),
        line("2026-09-27", "CLUBE FIT", 129_90),
        line("2026-10-04", "CLUBE FIT", 109_90),
        line("2026-09-07", "Amazon Prime Canais", 29_90),
        line("2026-10-07", "Amazon Prime Canais", 29_90),
      ],
      today,
      [],
    );
    expect(r.items.map((i) => [i.key, i.amount, i.twin])).toEqual([
      ["clubefit|12990", 129_90, true],
      ["clubefit|10990", 109_90, true],
      ["amazonprimecanais|2990", 29_90, false],
    ]);
    expect(r.total).toBe(269_70);
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
      line("2026-09-17", "ACADEMIA CENTRAL", 149_90),
      line("2026-10-17", "ACADEMIA CENTRAL", 149_90),
      // Running for months: not news.
      line("2026-07-06", "EBN*SPOTIFY", 23_90),
      line("2026-08-06", "EBN*SPOTIFY", 23_90),
      line("2026-09-06", "EBN*SPOTIFY", 23_90),
      line("2026-10-06", "EBN*SPOTIFY", 23_90),
    ];
    expect(subscriptionNews(lines, today, [])).toEqual([
      {
        kind: "nova",
        key: "nova|academiacentral|14990|cartao azul",
        description: "ACADEMIA CENTRAL",
        card: "Cartão Azul",
        amount: 149_90,
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
        line("2026-08-12", "CLUBE FIT", 89_90, { card: "Cartão Verde" }),
        line("2026-09-12", "CLUBE FIT", 89_90, { card: "Cartão Verde" }),
        line("2026-10-12", "CLUBE FIT", 89_90, { card: "Cartão Verde" }),
        line("2026-10-14", "CLUBE FIT", 129_90),
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
      line("2026-07-03", "LOJA DE MOVEIS", 88_40, {
        installment: 4,
        installments: 12,
        billMonth: "2026-10",
      }),
      line("2026-10-06", "PADARIA", 30_00, { billMonth: "2026-11" }),
    ];
    expect(cardsBillSpend(lines, "2026-11", [])).toBe(118_40);
  });

  it("does not count a parcel twice once the bank lists it", () => {
    const lines = [
      line("2026-07-03", "LOJA DE MOVEIS", 88_40, {
        installment: 4,
        installments: 12,
        billMonth: "2026-10",
      }),
      line("2026-07-03", "LOJA DE MOVEIS", 88_40, {
        installment: 5,
        installments: 12,
        billMonth: "2026-11",
      }),
    ];
    expect(cardsBillSpend(lines, "2026-11", [])).toBe(88_40);
  });
});

describe("subscriptions that go up or are new", () => {
  it("keeps one that went up on the list at its new value, saying what it was", () => {
    const r = subscriptions(
      [
        line("2026-08-12", "IA ASSISTENTE", 100_00),
        line("2026-09-12", "IA ASSISTENTE", 100_00),
        line("2026-10-12", "IA ASSISTENTE", 110_00),
      ],
      localDate("2026-11-20"),
      [],
    );
    // 69 days after the last charge of the old value, it still counts: it charged in October.
    expect(r.items).toMatchObject([
      { key: "iaassistente|10000", amount: 110_00, before: 100_00, charges: 3, last: "2026-10-12" },
    ]);
    expect(r.total).toBe(110_00);
  });

  it("does not take a big purchase a month later at the same store for a rise", () => {
    const lines = [
      line("2026-08-12", "LOJA ONLINE", 19_90),
      line("2026-09-12", "LOJA ONLINE", 19_90),
      line("2026-10-12", "LOJA ONLINE", 150_00),
    ];
    expect(subscriptions(lines, today, []).items).toMatchObject([{ amount: 19_90, before: null }]);
    expect(subscriptionNews(lines, today, [])).toEqual([]);
  });

  it("says a subscription is new for a month after its second charge", () => {
    const lines = [
      line("2026-09-21", "CLUBE DO LIVRO", 44_90),
      line("2026-10-21", "CLUBE DO LIVRO", 44_90),
    ];
    expect(subscriptions(lines, localDate("2026-11-10"), []).items[0]?.isNew).toBe(true);
    expect(subscriptions(lines, localDate("2026-11-25"), []).items[0]?.isNew).toBe(false);
  });
});

describe("subscriptionList", () => {
  const at = localDate("2026-11-20");
  const monthly = (description: string, amount: number, days: string[], extra = {}) =>
    days.map((d) => line(d, description, amount, extra));
  const lines = [
    ...monthly("NETFLIX", 39_90, ["2026-09-03", "2026-10-03", "2026-11-03"]),
    ...monthly("MUSICA", 21_90, ["2026-09-12", "2026-10-12", "2026-11-12"]),
    ...monthly("JORNAL", 9_90, ["2026-09-16", "2026-10-16", "2026-11-16"]),
    // Marked to cancel in August, and it stopped.
    ...monthly("APP TREINO", 19_90, ["2026-07-15", "2026-08-15"]),
  ];

  it("says what is marked, kept, hidden and still to decide, and what was cut", () => {
    const r = subscriptionList(lines, at, [], {
      cancel: ["netflix|3990", "apptreino|1990"],
      kept: ["musica|2190"],
      hidden: ["jornal|990"],
    });
    expect(r.items.map((i) => [i.key, i.cancel, i.kept])).toEqual([
      ["netflix|3990", true, false],
      ["musica|2190", false, true],
    ]);
    expect(r).toMatchObject({ total: 61_80, toCancel: 39_90, undecided: 0 });
    expect(r.hidden.map((i) => i.key)).toEqual(["jornal|990"]);
    expect(r.cut).toEqual({
      items: [{ key: "apptreino|1990", description: "APP TREINO", amount: 19_90 }],
      total: 19_90,
    });
  });

  it("does not count as cut a store that still charges, at another value", () => {
    const up = [...lines, line("2026-11-10", "APP TREINO", 24_90)];
    expect(subscriptionList(up, at, [], { cancel: ["apptreino|1990"] }).cut.items).toEqual([]);
  });

  it("says when one marked to cancel charged again after the mark, also after it had stopped", () => {
    const back = [...lines, line("2026-11-15", "APP TREINO", 19_90)];
    const marks = {
      cancel: ["netflix|3990", "apptreino|1990"],
      cancelOn: {
        "netflix|3990": localDate("2026-10-20"),
        "apptreino|1990": localDate("2026-08-20"),
      },
    };
    const r = subscriptionList(back, at, [], marks);
    expect(r.items.filter((i) => i.again).map((i) => [i.key, i.again, i.charges])).toEqual([
      ["netflix|3990", "2026-11-03", 3],
      ["apptreino|1990", "2026-11-15", 1],
    ]);
    expect(r.cut.items).toEqual([]);
    // Only the charge of this week is news.
    expect(
      chargedAgainNews(r, at, marks.cancelOn).map((n) => [n.kind, n.description, n.date]),
    ).toEqual([["cobrou", "APP TREINO", "2026-11-15"]]);
  });

  it("shows who pays part of a subscription split every month", () => {
    const r = subscriptionList(lines, at, [], {
      cancel: [],
      owners: [{ key: "cartao azul|musica|2190|mensal", person: "Lia", share: cents(10_95) }],
    });
    const musica = r.items.find((i) => i.key === "musica|2190");
    expect(musica).toMatchObject({
      splitKey: "cartao azul|musica|2190|mensal",
      split: { person: "Lia", share: 10_95 },
    });
  });
});
