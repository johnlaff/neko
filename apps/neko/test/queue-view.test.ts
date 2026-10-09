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
      { label: "Saída de 15/10", before: 0, after: 50000 },
      { label: "Economia de out", before: null, after: 50000 },
    ]);
    expect(saving("resgate")[1]).toEqual({ label: "Economia de out", before: null, after: -50000 });
  });
});
