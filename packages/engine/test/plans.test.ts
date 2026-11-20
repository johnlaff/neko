import { describe, expect, it } from "vitest";
import {
  type BankCardLine,
  cents,
  installmentPlans,
  localDate,
  ownerKey,
  theirsAfter,
} from "../src/index.ts";

const parcel = (
  description: string,
  amount: number,
  billMonth: string,
  installment: number,
  installments: number,
  extra: Partial<BankCardLine> = {},
) =>
  ({
    card: "Cartão Azul",
    amount: cents(amount),
    billMonth,
    description,
    installment,
    installments,
    date: localDate("2026-08-03"),
    ...extra,
  }) satisfies BankCardLine;

describe("installment plans", () => {
  it("follows a plan bill by bill, though the bank shortens the text and rounds the first", () => {
    const [p, ...rest] = installmentPlans(
      [
        parcel("MERCADOLIVRE*MERCADOLI", 150_02, "2026-11", 1, 3),
        parcel("MERCADOLIVRE*MERC", 150_01, "2026-12", 2, 3),
      ],
      "2026-11",
      [],
    );
    expect(rest).toEqual([]);
    expect(p).toMatchObject({
      description: "MERCADOLIVRE*MERCADOLI",
      installments: 3,
      first: "2026-11",
      last: "2027-01",
      person: null,
      share: null,
      theirCard: false,
    });
    expect(p?.bills).toEqual([
      { month: "2026-11", installment: 1, amount: 150_02, theirs: 0 },
      { month: "2026-12", installment: 2, amount: 150_01, theirs: 0 },
      { month: "2027-01", installment: 3, amount: 150_01, theirs: 0 },
    ]);
  });

  it("reads the whole plan from the one parcel the bank listed", () => {
    const [p] = installmentPlans(
      [parcel("NOTEBOOK 05/10", 420_00, "2026-12", 5, 10)],
      "2026-11",
      [],
    );
    expect(p?.first).toBe("2026-08");
    expect(p?.last).toBe("2027-05");
    expect(p?.bills.map((b) => [b.month, b.installment])).toEqual([
      ["2026-11", 4],
      ["2026-12", 5],
      ["2027-01", 6],
      ["2027-02", 7],
      ["2027-03", 8],
      ["2027-04", 9],
      ["2027-05", 10],
    ]);
  });

  it("starts at the month asked for and leaves out a plan that ended before it", () => {
    const plans = installmentPlans(
      [
        parcel("NOTEBOOK 05/10", 420_00, "2026-12", 5, 10),
        parcel("TENIS 05/05", 79_98, "2026-12", 5, 5),
      ],
      "2027-01",
      [],
    );
    expect(plans.map((p) => p.description)).toEqual(["NOTEBOOK 05/10"]);
    expect(plans[0]?.bills[0]).toEqual({
      month: "2027-01",
      installment: 6,
      amount: 420_00,
      theirs: 0,
    });
  });

  it("gives someone else their part: all of a marked plan, or the share of each parcel", () => {
    const sofa = parcel("SOFA CASA 04/10", 300_00, "2026-12", 4, 10);
    const bota = parcel("BOTA COURO 02/04", 99_90, "2026-12", 2, 4);
    const plans = installmentPlans([sofa, bota], "2026-12", [
      { key: ownerKey(sofa) ?? "", person: "Lia", share: cents(150_00) },
      { key: ownerKey(bota) ?? "", person: "Lia" },
    ]);
    const bySofa = plans.find((p) => p.description.startsWith("SOFA"));
    const byBota = plans.find((p) => p.description.startsWith("BOTA"));
    expect(bySofa).toMatchObject({ person: "Lia", share: 150_00, key: ownerKey(sofa) });
    expect(bySofa?.bills.every((b) => b.theirs === 150_00)).toBe(true);
    expect(byBota).toMatchObject({ person: "Lia", share: null });
    expect(byBota?.bills.every((b) => b.theirs === 99_90)).toBe(true);
  });

  it("gives a plan on someone else's card all to them, with nothing to mark", () => {
    const [p] = installmentPlans(
      [parcel("SMARTPHONE 06/10", 150_00, "2026-12", 6, 10, { card: "Cartão Verde" })],
      "2026-12",
      [],
      new Map([["cartao verde", "Lia"]]),
    );
    expect(p).toMatchObject({ person: "Lia", theirCard: true, key: null, share: null });
    expect(p?.bills.every((b) => b.theirs === b.amount)).toBe(true);
  });

  it("keeps two equal purchases on one bill apart", () => {
    const plans = installmentPlans(
      [
        parcel("PRESENTE 01/03", 90_00, "2026-12", 1, 3),
        parcel("PRESENTE 01/03", 90_00, "2026-12", 1, 3),
        parcel("PRESENTE 02/03", 90_00, "2027-01", 2, 3),
        parcel("PRESENTE 02/03", 90_00, "2027-01", 2, 3),
      ],
      "2026-12",
      [],
    );
    expect(plans).toHaveLength(2);
    for (const p of plans) expect(p.bills.map((b) => b.installment)).toEqual([1, 2, 3]);
  });

  it("leaves out a plan the bank put whole on one bill, single charges and refunds", () => {
    const plans = installmentPlans(
      [
        parcel("LOJA 01/03", 50_00, "2026-12", 1, 3),
        parcel("LOJA 02/03", 50_00, "2026-12", 2, 3),
        parcel("LOJA 03/03", 50_00, "2026-12", 3, 3),
        { ...parcel("MERCADO", 80_00, "2026-12", 1, 1), installment: null, installments: null },
        parcel("ESTORNO 02/04", -30_00, "2026-12", 2, 4),
      ],
      "2026-12",
      [],
    );
    expect(plans).toEqual([]);
  });
});

describe("a person's parcels after a month", () => {
  it("adds their part of every plan on the later bills, a plan that starts later too", () => {
    const sofa = parcel("SOFA CASA 04/10", 300_00, "2026-10", 4, 10);
    const fone = parcel("FONE 01/03", 129_90, "2026-11", 1, 3);
    const plans = installmentPlans(
      [sofa, fone, parcel("NOTEBOOK 05/10", 420_00, "2026-10", 5, 10)],
      "2026-10",
      [
        { key: ownerKey(sofa) ?? "", person: "Lia", share: cents(150_00) },
        { key: ownerKey(fone) ?? "", person: "Lia" },
      ],
    );
    // Half of the sofa's six parcels after October, and the three earphones from November.
    expect(theirsAfter(plans, "Lia", "2026-10")).toEqual({
      amount: 6 * 150_00 + 3 * 129_90,
      until: "2027-04",
    });
    expect(theirsAfter(plans, "Lia", "2027-04")).toEqual({ amount: 0, until: null });
    expect(theirsAfter(plans, "Bia", "2026-10")).toEqual({ amount: 0, until: null });
  });
});
