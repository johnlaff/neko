import { cents, localDate } from "@neko/engine";
import { describe, expect, it } from "vitest";
import { draftLines } from "../src/shared/queue.ts";

describe("queue lines", () => {
  it("shows a saving as the Saída it adds and the change to the month's Economia", () => {
    const saving = (kind: "reserva" | "resgate") =>
      draftLines(
        {
          type: "new",
          kind,
          amount: cents(50000),
          description: "Reserva",
          date: localDate("2026-10-15"),
        },
        [],
        [],
      );
    expect(saving("reserva")).toEqual([
      { label: "15/10 · Saída · Reserva", change: "new", before: null, after: 50000, cell: null },
      { label: "Economia de out", change: "economia", before: null, after: 50000, cell: null },
    ]);
    expect(saving("resgate")[1]).toEqual({
      label: "Economia de out",
      change: "economia",
      before: null,
      after: -50000,
      cell: null,
    });
  });

  it("shows a card's own line and, when the day has more, the day's whole Saída", async () => {
    const { cell, item, ledger } = await import("../../../packages/engine/test/builders.ts");
    // Two cards due on Nov 12: 319,41 and 100,00.
    const days = ledger("2026-11-01", 30, 0, {
      "2026-11-12": { saida: cell(41941, [item(31941, "Visa"), item(10000, "Visa Gio")]) },
    });
    const visa = { name: "Visa", closingDay: 29, dueDay: 12, closingEstimated: false };
    expect(
      draftLines(
        {
          type: "card",
          card: "Visa",
          bills: [{ due: localDate("2026-11-12"), was: cents(31941), amount: cents(40255) }],
        },
        days,
        [visa],
      ),
    ).toEqual([
      {
        label: "12/11 · Saída · Visa",
        change: "edit",
        before: 31941,
        after: 40255,
        cell: { label: "Saída do dia", before: 41941, after: 50255 },
      },
    ]);
  });
});
