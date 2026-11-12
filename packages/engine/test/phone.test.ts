import { describe, expect, it } from "vitest";
import {
  type BankCardLine,
  cents,
  localDate,
  onePerPurchase,
  PHONE_TRUST_AFTER,
  type PhoneRead,
  phoneReads,
} from "../src/index.ts";

// Invented card and shops (public repo).
const line = (amount: number, date: string, over: Partial<BankCardLine> = {}): BankCardLine => ({
  card: "Cartão Azul",
  amount: cents(amount),
  billMonth: "2026-12",
  description: "PADARIA",
  installment: null,
  installments: null,
  date: localDate(date),
  ...over,
});

/** A read of the Azul bank's app, the bank last read on `readOn`. */
const read = (
  amount: number,
  date: string,
  readOn: string | null = "2026-11-11",
  over: Partial<PhoneRead> = {},
): PhoneRead => ({
  ...line(amount, date),
  date: localDate(date),
  bank: "Azul",
  bankReadOn: readOn === null ? null : localDate(readOn),
  ...over,
});

/** Three reads the bank already brought: the Azul bank is trusted, once released. */
const proven = [read(1000, "2026-11-01"), read(2000, "2026-11-02"), read(3000, "2026-11-03")];
const provenLines = [line(1000, "2026-11-01"), line(2000, "2026-11-03"), line(3000, "2026-11-03")];
const azul = new Set(["Azul"]);
const none = new Set<string>();

describe("a purchase the phone read, before the bank brings it", () => {
  it("is matched to the bank's charge: same card, same amount, a few days apart, one each", () => {
    const bank = [line(4590, "2026-11-11", { description: "PADARIA DO ZE LTDA" })];
    const twice = [...proven, read(4590, "2026-11-10"), read(4590, "2026-11-10")];
    // The bank dates it a day later and writes the shop its own way; the twin still waits.
    expect(phoneReads(twice, [...provenLines, ...bank], azul).provisional).toEqual([
      line(4590, "2026-11-10"),
    ]);
    // Too far in time, or on another card: not the same purchase.
    const far = [line(4590, "2026-11-20")];
    const other = [line(4590, "2026-11-10", { card: "Cartão Verde" })];
    const fresh = [...proven, read(4590, "2026-11-10")];
    expect(phoneReads(fresh, [...provenLines, ...far], azul).provisional).toHaveLength(1);
    expect(phoneReads(fresh, [...provenLines, ...other], azul).provisional).toHaveLength(1);
  });

  it("only learns until its bank app is released by hand, however many the bank confirmed", () => {
    const fresh = read(4590, "2026-11-10");
    expect(phoneReads([...proven, fresh], provenLines, none)).toEqual({
      provisional: [],
      trust: [{ bank: "Azul", judged: 3, matched: 3, trusted: false }],
    });
  });

  it("counts once released, while the bank confirmed its last reads in a row", () => {
    const fresh = read(4590, "2026-11-10");
    // Not judged yet: the bank was read only a day after it.
    expect(phoneReads([fresh], [], azul)).toEqual({
      provisional: [],
      trust: [{ bank: "Azul", judged: 0, matched: 0, trusted: false }],
    });
    // Two confirmed are not enough.
    expect(phoneReads([...proven.slice(1), fresh], provenLines.slice(1), azul).provisional).toEqual(
      [],
    );
    expect(PHONE_TRUST_AFTER).toBe(3);
    expect(phoneReads([...proven, fresh], provenLines, azul)).toEqual({
      provisional: [line(4590, "2026-11-10")],
      trust: [{ bank: "Azul", judged: 3, matched: 3, trusted: true }],
    });
  });

  it("stops counting when the bank, read days later, never brought one", () => {
    // Read on the 4th: the bank, read on the 11th, has no such charge. The read was wrong.
    const wrong = read(9990, "2026-11-04");
    const fresh = read(4590, "2026-11-10");
    expect(phoneReads([...proven, wrong, fresh], provenLines, azul)).toEqual({
      provisional: [],
      trust: [{ bank: "Azul", judged: 4, matched: 3, trusted: false }],
    });
    // Not yet judged while the bank was not read long enough after it.
    const stale = [...proven, read(9990, "2026-11-04", "2026-11-06"), fresh];
    expect(phoneReads(stale, provenLines, azul).trust).toEqual([
      { bank: "Azul", judged: 3, matched: 3, trusted: true },
    ]);
    expect(phoneReads(stale, provenLines, azul).provisional).toHaveLength(2);
    // Three confirmed after the miss bring it back.
    const again = [
      ...proven,
      wrong,
      read(1100, "2026-11-05"),
      read(1200, "2026-11-06"),
      read(1300, "2026-11-07"),
    ];
    const bank = [
      ...provenLines,
      line(1100, "2026-11-05"),
      line(1200, "2026-11-06"),
      line(1300, "2026-11-08"),
    ];
    expect(phoneReads(again, bank, azul).trust).toEqual([
      { bank: "Azul", judged: 7, matched: 6, trusted: true },
    ]);
  });

  it("weighs each bank's app on its own", () => {
    const other = read(4590, "2026-11-10", null, { bank: "Verde", card: "Cartão Verde" });
    expect(phoneReads([...proven, other], provenLines, new Set(["Azul", "Verde"]))).toEqual({
      provisional: [],
      trust: [
        { bank: "Azul", judged: 3, matched: 3, trusted: true },
        { bank: "Verde", judged: 0, matched: 0, trusted: false },
      ],
    });
  });
});

describe("the same purchase told twice", () => {
  const at = (bank: string, amount: number, last4: string | null, time: string) => ({
    bank,
    amount,
    last4,
    at: `2026-11-10T${time}:00.000Z`,
  });

  it("is kept once: same bank, amount and card, minutes apart, the one with the card's digits", () => {
    expect(
      onePerPurchase([
        at("Azul", 4590, null, "15:00"),
        at("Azul", 4590, "1234", "15:02"),
        at("Azul", 4590, "1234", "15:30"),
        at("Azul", 4590, "9999", "15:01"),
        at("Verde", 4590, "1234", "15:01"),
        at("Azul", 1000, "1234", "15:01"),
      ]),
    ).toEqual([
      at("Azul", 4590, "1234", "15:02"),
      at("Azul", 4590, "1234", "15:30"),
      at("Azul", 4590, "9999", "15:01"),
      at("Verde", 4590, "1234", "15:01"),
      at("Azul", 1000, "1234", "15:01"),
    ]);
  });
});
