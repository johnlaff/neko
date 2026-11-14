import { type CardConfig, localDate } from "@neko/engine";
import { describe, expect, it } from "vitest";
import { UserSettings } from "../src/shared/types.ts";
import {
  type BankRows,
  type BankTxnRow,
  bankInput,
  bankVersion,
  bankView,
  loadBank,
} from "../src/worker/bank.ts";
import { PHONE_RELEASED } from "../src/worker/phone.ts";
import { loadProposals, saveProposal } from "../src/worker/proposals.ts";
import { sqliteD1 } from "./d1.ts";

// Invented bank: ids, names and amounts are made up (public repo).
const txn = (over: Partial<BankRows["txns"][number]>): BankRows["txns"][number] => ({
  account_id: "conta",
  date: "2026-10-05",
  amount: 1000,
  type: "DEBIT",
  description: "LOJA",
  installment: null,
  installments: null,
  bill_id: null,
  card_number: null,
  ...over,
});
const rows: BankRows = {
  items: 1,
  syncedAt: "2026-10-08T09:00:00.000Z",
  accounts: [
    { id: "conta", type: "BANK" },
    { id: "cartao", type: "CREDIT" },
  ],
  txns: [
    txn({ amount: 5000, type: "CREDIT", description: "PIX RECEBIDO" }),
    txn({ amount: -1990, description: "PADARIA" }),
    txn({ account_id: "cartao", amount: 12000, bill_month: "2026-11", card_number: "**** 1111" }),
    txn({ account_id: "cartao", amount: 3000, bill_month: "2026-11", card_number: "2222" }),
    txn({
      account_id: "cartao",
      amount: 500,
      type: "CREDIT",
      bill_id: "b1",
      bill_month: "2026-09",
    }),
    txn({ account_id: "cartao", amount: 700, card_number: "1111" }),
  ],
  bills: [{ id: "b1", account_id: "cartao", due_date: "2026-10-12", total: 98000 }],
};
// Closes on the 29th, due on the 12th: a purchase on Oct 5 lands on the bill due Nov 12.
const cards: CardConfig[] = ["Visa", "Visa Gio"].map((name) => ({
  name,
  closingDay: 29,
  dueDay: 12,
  closingEstimated: false,
}));
const map: UserSettings["bankCards"] = [
  { accountId: "cartao", cardNumber: null, card: "Visa" },
  { accountId: "cartao", cardNumber: "2222", card: "Visa Gio" },
];

describe("bank rows to the engine", () => {
  it("signs by type, names each card line by its number, then by its account, and dates it by the card's cycle", () => {
    const { lines, movements } = bankInput(rows, map, cards);
    expect(movements.map((m) => [m.description, m.amount])).toEqual([
      ["PIX RECEBIDO", 5000],
      ["PADARIA", -1990],
    ]);
    expect(lines.map((l) => [l.card, l.amount, l.billMonth])).toEqual([
      ["Visa", 12000, "2026-11"],
      ["Visa Gio", 3000, "2026-11"],
      ["Visa", -500, "2026-10"],
      ["Visa", 700, "2026-11"],
    ]);
  });

  it("gives each listed bill's total with the cards of its account, the holder's the one for the account as a whole", () => {
    expect(bankInput(rows, map, cards).closed).toEqual([
      { cards: ["Visa", "Visa Gio"], billMonth: "2026-10", total: 98000, holder: "Visa" },
    ]);
    expect(bankInput(rows, map.slice(0, 1), cards).closed).toEqual([
      { cards: ["Visa"], billMonth: "2026-10", total: 98000, holder: "Visa" },
    ]);
    expect(bankInput(rows, map.slice(1), cards).closed).toEqual([
      { cards: ["Visa Gio"], billMonth: "2026-10", total: 98000 },
    ]);
  });

  it("never puts a line the bank left off a listed bill on that bill", () => {
    // Closes on the 29th by the card's cycle, but the bank already closed the bill due Oct 12
    // without it: a purchase made on the closing day goes to the next one.
    const late = txn({ account_id: "cartao", date: "2026-09-29", amount: 900 });
    const { lines } = bankInput({ ...rows, txns: [...rows.txns, late] }, map, cards);
    expect(lines.at(-1)).toMatchObject({ amount: 900, billMonth: "2026-11" });
  });

  it("keeps a closing-day line off that bill after the bank lists the next one", () => {
    // Bill due Oct 12 closed on Sep 29 without it; the bill due Nov 12 is listed now too.
    const late = txn({ account_id: "cartao", date: "2026-09-29", amount: 900 });
    const bills = [
      {
        id: "b1",
        account_id: "cartao",
        due_date: "2026-10-12",
        close_date: "2026-09-29",
        total: 98000,
      },
      {
        id: "b2",
        account_id: "cartao",
        due_date: "2026-11-12",
        close_date: "2026-10-29",
        total: 900,
      },
    ];
    const { lines } = bankInput({ ...rows, txns: [late], bills }, map, cards);
    expect(lines.map((l) => [l.amount, l.billMonth])).toEqual([[900, "2026-11"]]);
  });

  it("keeps a line from before the listed bill closed on that bill, though the bank has not tied it yet", () => {
    // The bank just closed the bill due Nov 12 on Oct 29 and still lists its lines unattached.
    const listed = {
      ...rows,
      txns: [
        txn({ account_id: "cartao", date: "2026-10-20", amount: 870 }),
        txn({ account_id: "cartao", date: "2026-10-29", amount: 400 }),
      ],
      bills: [
        {
          id: "b2",
          account_id: "cartao",
          due_date: "2026-11-12",
          close_date: "2026-10-29",
          total: 870,
        },
      ],
    };
    expect(bankInput(listed, map, cards).lines.map((l) => [l.amount, l.billMonth])).toEqual([
      [870, "2026-11"],
      [400, "2026-12"],
    ]);
  });

  it("drops card lines with no sheet name or no bill to land on", () => {
    expect(bankInput(rows, [], cards).lines).toEqual([]);
    expect(bankInput({ ...rows, txns: rows.txns.slice(2, 4) }, map, []).lines).toEqual([]);
  });
});

describe("a card purchase the phone read from the bank app", () => {
  // The linked bank whose label names the phone's bank; its only card account. Read on the 8th.
  const linked: BankRows = {
    ...rows,
    itemRows: [{ item_id: "i", label: "Banco Inter", synced_at: "2026-10-08T09:00:00.000Z" }],
    accounts: [
      { id: "conta", type: "BANK", item_id: "i" },
      { id: "cartao", type: "CREDIT", item_id: "i" },
    ],
    txns: [],
  };
  const seen = {
    id: "phone-0001",
    bank: "Inter" as const,
    amount: 4590,
    last4: "2222",
    merchant: "LIVRARIA",
    at: "2026-10-06T15:00:00.000Z",
  };
  /** Three reads of the bank's app that the bank brought, the same days: the app is trusted. */
  const proven = (bank: "Inter" | "Bradesco", last4: string) => {
    const days = ["2026-09-20", "2026-09-21", "2026-09-22"];
    return {
      phone: days.map((d, i) => ({
        ...seen,
        id: `phone-${bank}-${i}`,
        bank,
        last4,
        amount: 1000 * (i + 1),
        at: `${d}T15:00:00.000Z`,
      })),
      txns: days.map((d, i) =>
        txn({ account_id: "cartao", date: d, amount: 1000 * (i + 1), card_number: last4 }),
      ),
    };
  };
  const trusted = proven("Inter", "2222");
  const both = new Set(["Inter", "Bradesco"]);
  const read = (phone: (typeof seen)[], txns: BankRows["txns"] = [], released = both) =>
    bankInput(
      { ...linked, txns: [...trusted.txns, ...txns], phone: [...trusted.phone, ...phone] },
      map,
      cards,
      released,
    );

  it("lands on its card's bill by the cycle, by its last digits or else the account's card", () => {
    expect(read([seen]).provisional).toEqual([
      {
        card: "Visa Gio",
        amount: 4590,
        billMonth: "2026-11",
        description: "LIVRARIA",
        installment: null,
        installments: null,
        date: "2026-10-06",
      },
    ]);
    expect(read([{ ...seen, last4: null }]).provisional).toMatchObject([
      { card: "Visa", amount: 4590 },
    ]);
    expect(read([seen]).phoneTrust).toEqual([
      { bank: "Inter", judged: 3, matched: 3, trusted: true },
    ]);
  });

  it("only learns while no bank app is released, as now", () => {
    const learning = read([seen], [], PHONE_RELEASED);
    expect(PHONE_RELEASED.size).toBe(0);
    expect(learning.provisional).toEqual([]);
    expect(learning.phoneTrust).toEqual([{ bank: "Inter", judged: 3, matched: 3, trusted: false }]);
  });

  it("waits for the bank while the bank has not confirmed that app's reads", () => {
    const learning = bankInput({ ...linked, phone: [seen] }, map, cards, both);
    expect(learning.provisional).toEqual([]);
    expect(learning.phoneTrust).toEqual([{ bank: "Inter", judged: 0, matched: 0, trusted: false }]);
  });

  it("steps aside once the bank brings the same charge", () => {
    const brought = txn({
      account_id: "cartao",
      date: "2026-10-07",
      amount: 4590,
      card_number: "2222",
    });
    expect(read([seen], [brought]).provisional).toEqual([]);
    expect(read([seen], [brought]).lines).toHaveLength(4);
  });

  it("stops counting the app when the bank, read days later, never brought one", () => {
    // Read on the 1st; the bank, read on the 8th, has no such charge.
    const wrong = { ...seen, id: "phone-0000", amount: 9990, at: "2026-10-01T15:00:00.000Z" };
    expect(read([wrong, seen]).provisional).toEqual([]);
    expect(read([wrong, seen]).phoneTrust).toEqual([
      { bank: "Inter", judged: 4, matched: 3, trusted: false },
    ]);
  });

  it("counts one purchase both bank apps told once", () => {
    const twin = { ...seen, id: "phone-0002", last4: null, at: "2026-10-06T15:01:00.000Z" };
    expect(read([twin, seen]).provisional).toMatchObject([{ card: "Visa Gio", amount: 4590 }]);
  });

  it("finds its card by digits the bank already brought, whatever the bank's label", () => {
    const bradesco = proven("Bradesco", "7777");
    const other = { ...seen, bank: "Bradesco" as const, last4: "7777" };
    expect(
      bankInput(
        { ...linked, txns: bradesco.txns, phone: [...bradesco.phone, other] },
        map,
        cards,
        both,
      ).provisional,
    ).toMatchObject([{ card: "Visa", amount: 4590 }]);
  });

  it("is left out when no linked bank is the phone's", () => {
    const other = { ...seen, bank: "Bradesco" as const, last4: "9999" };
    expect(bankInput({ ...linked, phone: [other] }, map, cards).phoneTrust).toEqual([]);
  });
});

describe("a card outside Open Finance, by its closing e-mail", () => {
  // Closes on the 25th, due on the 2nd; no bank feed at all.
  const nu: CardConfig = {
    name: "Cartao Roxo",
    closingDay: 25,
    dueDay: 2,
    closingEstimated: false,
  };
  const mailed = {
    ...rows,
    mailedBills: [{ card: "Cartao Roxo", due_date: "2026-11-02", total: 4321 }],
  };

  it("is a closed bill of that card alone", () => {
    expect(bankInput(mailed, map, [...cards, nu]).closed).toContainEqual({
      cards: ["Cartao Roxo"],
      billMonth: "2026-11",
      total: 4321,
      holder: "Cartao Roxo",
    });
  });

  it("proposes the bill in Para lançar while it is still to be paid", async () => {
    const { ledger } = await import("../../../packages/engine/test/builders.ts");
    const view = bankView(
      { ...mailed, txns: [], bills: [] },
      ledger("2026-10-01", 92, 100000),
      [...cards, nu],
      UserSettings.parse({ bankCards: map }),
      localDate("2026-10-28"),
    );
    expect(view?.queue?.map((i) => i.key)).toEqual(["card:cartao roxo:2026-11-02=0>4321"]);
  });

  it("is read from its table", async () => {
    const db = sqliteD1();
    db.sqlite.exec(
      "INSERT INTO bank_item (item_id, label, synced_at) VALUES ('i', 'Banco', '2026-10-08T09:00:00Z'); INSERT INTO mailed_bill (card, due_date, total, read_at) VALUES ('Cartao Roxo', '2026-11-02', 4321, 't')",
    );
    expect((await loadBank(db as never))?.mailedBills).toEqual([
      { card: "Cartao Roxo", due_date: "2026-11-02", total: 4321 },
    ]);
  });
});

describe("a light or phone bill, by the biller's e-mail", () => {
  const mailed = {
    ...rows,
    txns: [],
    bills: [],
    mailedContas: [
      {
        biller: "Luzdovale",
        due_date: "2026-11-15",
        total: 18760,
        read_at: "2026-10-20T12:00:00.000Z",
      },
    ],
  };

  it("proposes the bill on its due day while it is still to be paid, as a Conta", async () => {
    const { ledger } = await import("../../../packages/engine/test/builders.ts");
    const view = bankView(
      mailed,
      ledger("2026-10-01", 92, 100000),
      cards,
      UserSettings.parse({ bankCards: map }),
      localDate("2026-10-28"),
    );
    expect(view?.queue).toMatchObject([
      {
        key: "mail:luzdovale:2026-11-15:18760",
        kind: "conta",
        title: "Luzdovale",
        bank: [{ date: "2026-11-15", amount: -18760, description: "Conta Luzdovale por e-mail" }],
        note: "A conta chegou por e-mail e a planilha ainda não tem.",
      },
    ]);
  });

  it("is read from its table", async () => {
    const db = sqliteD1();
    db.sqlite.exec(
      "INSERT INTO bank_item (item_id, label, synced_at) VALUES ('i', 'Banco', '2026-10-08T09:00:00Z'); INSERT INTO mailed_conta (biller, due_date, total, read_at) VALUES ('Luzdovale', '2026-11-15', 18760, 't')",
    );
    expect((await loadBank(db as never))?.mailedContas).toEqual([
      { biller: "Luzdovale", due_date: "2026-11-15", total: 18760, read_at: "t" },
    ]);
  });
});

describe("what Mia proposed in a conversation", () => {
  it("waits in Para lançar as a new line, saying where it came from", async () => {
    const { ledger } = await import("../../../packages/engine/test/builders.ts");
    const db = sqliteD1();
    const entry = { kind: "diario", amount: 5230, description: "Mercado", date: "2026-10-27" };
    await saveProposal(db as never, entry as never, new Date("2026-10-27T15:00:00Z"));
    // A row that no longer parses is left out, never guessed.
    db.sqlite.exec(
      "INSERT INTO mia_proposal (id, entry, created_at) VALUES ('bad', '{\"kind\":\"diario\"}', 't')",
    );
    const stored = await loadProposals(db as never);
    expect(stored).toHaveLength(2);
    const view = bankView(
      { ...rows, txns: [], bills: [], proposals: stored },
      ledger("2026-10-01", 92, 100000),
      cards,
      UserSettings.parse({ bankCards: map }),
      localDate("2026-10-28"),
    );
    expect(view?.queue).toMatchObject([
      {
        key: `mia:${stored.find((r) => r.id !== "bad")?.id}`,
        kind: "diario",
        title: "Mercado",
        bank: [],
        adjustable: true,
        note: "Veio da sua conversa com a Mia.",
        options: [{ draft: { type: "new", ...entry } }],
      },
    ]);
  });
});

describe("bank tables", () => {
  it("are no bank at all until one is linked, and tell syncs apart", async () => {
    const db = sqliteD1();
    expect(await loadBank(db as never)).toBeNull();
    expect(bankVersion(null)).toBe("none");
    db.sqlite.exec(
      "INSERT INTO bank_item (item_id, label, synced_at) VALUES ('i', 'Banco', '2026-10-08T09:00:00Z')",
    );
    const read = await loadBank(db as never);
    expect(read).toMatchObject({ items: 1, syncedAt: "2026-10-08T09:00:00Z", txns: [] });
    expect(bankVersion(read)).not.toBe("none");
  });

  it("are as fresh as the bank Meu Pluggy read longest ago, not as Neko's last read", async () => {
    const db = sqliteD1();
    db.sqlite.exec(`INSERT INTO bank_item (item_id, label, synced_at, bank_updated_at) VALUES
      ('a', 'Banco A', '2026-10-08T09:00:00Z', '2026-10-08T01:25:00Z'),
      ('b', 'Banco B', '2026-10-08T09:00:00Z', '2026-10-08T01:18:00Z')`);
    expect((await loadBank(db as never))?.syncedAt).toBe("2026-10-08T01:18:00Z");
  });

  it("change version with any decision or bank value, not just a count", () => {
    const base: BankRows = { items: 1, syncedAt: "t", accounts: [], txns: [], bills: [] };
    const a = bankVersion({ ...base, decided: ["mov:a", "mov:z"] });
    expect(bankVersion({ ...base, decided: ["mov:b", "mov:z"] })).not.toBe(a);
    const t = { ...rows.txns[0] } as BankTxnRow;
    expect(bankVersion({ ...base, txns: [{ ...t, amount: t.amount + 1 }] })).not.toBe(
      bankVersion({ ...base, txns: [t] }),
    );
  });

  it("missing tables leave the sheet's screens alone", async () => {
    const db = sqliteD1();
    db.sqlite.exec(
      "DROP TABLE bank_txn; DROP TABLE bank_bill; DROP TABLE bank_account; DROP TABLE bank_item",
    );
    expect(await loadBank(db as never)).toBeNull();
  });
});

describe("settings", () => {
  it("keeps bank cards with a four-digit number or none", () => {
    expect(UserSettings.parse({}).bankCards).toEqual([]);
    expect(() =>
      UserSettings.parse({ bankCards: [{ accountId: "a", cardNumber: "12", card: "X" }] }),
    ).toThrow();
  });
});

describe("Para lançar from the bank rows", () => {
  it("keeps an ignored open bill out while the bank adds nothing, and lists it to bring back", async () => {
    const { ledger } = await import("../../../packages/engine/test/builders.ts");
    const days = ledger("2026-10-01", 92, 100000);
    const settings = UserSettings.parse({ bankCards: map });
    const open = {
      ...rows,
      txns: [txn({ account_id: "cartao", amount: 12000, bill_month: "2026-11" })],
      bills: [],
    };
    const view = (keys: string[]) =>
      bankView(
        { ...open, decided: keys, ignored: keys },
        days,
        cards,
        settings,
        localDate("2026-10-08"),
      );
    const key = "card:visa:2026-11-12=0>12000";
    expect(view([])?.queue?.map((i) => i.key)).toEqual([key]);
    const after = view([key]);
    expect(after?.queue).toEqual([]);
    expect(after?.ignored).toEqual([{ key, date: "2026-11-12", title: "Fatura Visa" }]);
    expect(after?.checks.find((c) => c.due === "2026-11-12")).toMatchObject({
      bank: 12000,
      gap: 0,
      disagrees: false,
    });
  });

  it("leaves a pending movement waiting and words each item in the sheet's terms", async () => {
    const { ledger } = await import("../../../packages/engine/test/builders.ts");
    const days = ledger("2026-10-01", 92, 100000);
    const settings = UserSettings.parse({ bankCards: map });
    const view = bankView(
      {
        ...rows,
        itemRows: [{ item_id: "i", label: "Banco A", synced_at: "2026-10-08T09:00:00.000Z" }],
        accounts: [
          { id: "conta", type: "BANK", item_id: "i", balance: 103010 },
          { id: "cartao", type: "CREDIT", item_id: "i" },
        ],
        txns: [
          txn({ id: "p1", amount: 5000, type: "CREDIT", description: "PIX RECEBIDO" }),
          txn({ id: "p2", amount: -1990, description: "PADARIA" }),
          txn({ id: "p3", amount: -700, description: "MERCADO", status: "PENDING" }),
          // A purchase from before the Oct 12 bill's cycle began: the feed saw that cycle whole.
          txn({
            id: "c0",
            account_id: "cartao",
            date: "2026-08-20",
            amount: 4000,
            bill_id: "b0",
            bill_month: "2026-09",
            card_number: "1111",
          }),
        ],
        bills: [
          { id: "b0", account_id: "cartao", due_date: "2026-09-12", total: 4000 },
          ...rows.bills,
        ],
      },
      days,
      cards,
      settings,
      localDate("2026-10-08"),
    );
    expect(view?.queue?.map((i) => [i.key, i.kind, i.title, i.options[0]?.lines])).toEqual([
      [
        "mov:p1",
        "entrada",
        "PIX RECEBIDO",
        [
          {
            label: "05/10 · Entrada",
            change: "new",
            before: null,
            after: 5000,
            diff: null,
            cell: null,
          },
        ],
      ],
      [
        "mov:p2",
        "diario",
        "PADARIA",
        [
          {
            label: "05/10 · Diário",
            change: "new",
            before: null,
            after: 1990,
            diff: null,
            cell: null,
          },
        ],
      ],
      // The closed bill shared by both cards lists none of its lines: the holder's card answers.
      [
        "card:visa:2026-10-12=0>98000",
        "cartao",
        "Fatura Visa",
        [
          {
            label: "12/10 · Saída · Visa",
            change: "edit",
            before: 0,
            after: 98000,
            diff: 98000,
            cell: null,
          },
        ],
      ],
    ]);
    expect(view?.queue?.[0]?.note).toBe("");
    expect(view?.queue?.[1]?.bank).toEqual([
      { date: "2026-10-05", amount: -1990, description: "PADARIA" },
    ]);
    expect(view?.saldo).toEqual({
      date: "2026-10-07",
      sheet: 100000,
      bank: 103010,
      diff: 3010,
      stale: [],
      waiting: [],
    });
  });
});

describe("Saldo against the bank", () => {
  it("takes out of yesterday's balance a debit the bank made today and still lists as pending", async () => {
    const { ledger } = await import("../../../packages/engine/test/builders.ts");
    const days = ledger("2026-10-01", 92, 100000);
    const view = bankView(
      {
        ...rows,
        itemRows: [{ item_id: "i", label: "Banco A", synced_at: "2026-10-08T09:00:00.000Z" }],
        accounts: [{ id: "conta", type: "BANK", item_id: "i", balance: 99001 }],
        // An insurance debit of this morning: already off the balance, though still pending.
        txns: [txn({ date: "2026-10-08", amount: -999, description: "SEGURO", status: "PENDING" })],
        bills: [],
      },
      days,
      cards,
      UserSettings.parse({ bankCards: map }),
      localDate("2026-10-08"),
    );
    expect(view?.saldo).toMatchObject({ date: "2026-10-07", sheet: 100000, bank: 100000, diff: 0 });
  });
});

describe("a bank Meu Pluggy stopped reading", () => {
  it("is named with the last day it was read, once a whole day went by", async () => {
    const { ledger } = await import("../../../packages/engine/test/builders.ts");
    const view = (today: string) =>
      bankView(
        {
          ...rows,
          itemRows: [
            { item_id: "a", label: "Banco A", synced_at: "2026-10-08T09:00:00.000Z" },
            // Neko asked today, but the bank itself was last read two days ago.
            {
              item_id: "b",
              label: "Banco B",
              synced_at: "2026-10-08T09:00:00.000Z",
              read_at: "2026-10-06T11:00:00.000Z",
            },
          ],
          accounts: [],
          txns: [],
          bills: [],
        },
        ledger("2026-10-01", 92, 100000),
        cards,
        UserSettings.parse({ bankCards: map }),
        localDate(today),
      );
    expect(view("2026-10-08")?.stalled).toEqual([{ label: "Banco B", since: "2026-10-06" }]);
    expect(view("2026-10-07")?.stalled).toEqual([]);
  });
});

describe("money to move before the bank debits a bill", () => {
  // The bank debited last month's bill from its own account, so it debits this one there too.
  const debiting: BankRows = {
    items: 1,
    syncedAt: "2026-11-10T09:00:00.000Z",
    itemRows: [{ item_id: "i", label: "Banco Azul", synced_at: "2026-11-10T09:00:00.000Z" }],
    accounts: [
      { id: "conta", type: "BANK", item_id: "i", balance: 100000 },
      { id: "cartao", type: "CREDIT", item_id: "i" },
    ],
    txns: [txn({ date: "2026-10-14", amount: -140000, description: "GASTOS CARTAO DE CREDITO" })],
    bills: [],
  };

  it("is the bill, holder and additional card together, less what the account has", async () => {
    const { cell, item, ledger } = await import("../../../packages/engine/test/builders.ts");
    const days = ledger("2026-10-01", 92, 500000, {
      "2026-11-12": { saida: cell(150000, [item(120000, "Visa"), item(30000, "Visa Gio")]) },
    });
    const view = bankView(
      debiting,
      days,
      cards,
      UserSettings.parse({ bankCards: map }),
      localDate("2026-11-10"),
    );
    expect(view?.transfers).toEqual([
      {
        to: "Banco Azul",
        amount: 50000,
        balance: 100000,
        bills: [
          { card: "Visa", due: "2026-11-12", amount: 120000 },
          { card: "Visa Gio", due: "2026-11-12", amount: 30000 },
        ],
      },
    ]);
  });
});
