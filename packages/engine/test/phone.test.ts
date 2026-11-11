import { describe, expect, it } from "vitest";
import { type BankCardLine, cents, localDate, stillProvisional } from "../src/index.ts";

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

describe("a purchase the phone saw before the bank sent it", () => {
  it("counts until the bank brings the same charge on the same card", () => {
    const seen = [line(4590, "2026-11-10"), line(12000, "2026-11-10", { description: "FARMACIA" })];
    expect(stillProvisional(seen, [])).toEqual(seen);
    // The bank dates it a day later and writes the shop its own way.
    const bank = [line(4590, "2026-11-11", { description: "PADARIA DO ZE LTDA" })];
    expect(stillProvisional(seen, bank)).toEqual([seen[1]]);
  });

  it("takes each bank charge for one purchase only, and never one far in time or on another card", () => {
    const twice = [line(4590, "2026-11-10"), line(4590, "2026-11-10")];
    expect(stillProvisional(twice, [line(4590, "2026-11-10")])).toEqual([twice[1]]);
    expect(stillProvisional([line(4590, "2026-11-10")], [line(4590, "2026-11-20")])).toHaveLength(
      1,
    );
    const other = [line(4590, "2026-11-10", { card: "Cartão Verde" })];
    expect(stillProvisional([line(4590, "2026-11-10")], other)).toHaveLength(1);
  });
});
