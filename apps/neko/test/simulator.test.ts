import { type Cents, cents } from "@neko/engine";
import { describe, expect, it } from "vitest";
import { simFigure } from "../src/web/Pace.tsx";

const c = (n: number): Cents => cents(n);

describe("simulator figure", () => {
  it("before a value is typed, says what still fits, or by how much it is already over", () => {
    expect(simFigure({ mode: "cycle", left: c(0), overBy: c(750_31) }, null)).toEqual({
      label: "Passa do plano",
      amount: 750_31,
      over: true,
    });
    expect(simFigure({ mode: "cycle", left: c(1_200_00), overBy: c(0) }, null)).toEqual({
      label: "Ainda cabem",
      amount: 1_200_00,
      over: false,
    });
  });

  it("with a purchase typed, speaks for what is left after it, never per day", () => {
    const cs = { mode: "cycle", left: c(1_200_00), overBy: c(0) } as const;
    expect(simFigure(cs, { remaining: c(800_00) })).toMatchObject({
      label: "Ainda cabem",
      amount: 800_00,
    });
    expect(simFigure(cs, { remaining: c(-300_00) })).toMatchObject({
      label: "Passa do plano",
      amount: 300_00,
      over: true,
    });
  });

  it("under a ceiling for the cards, going past it is passing the ceiling", () => {
    const cs = { mode: "cards", left: c(500_00), overBy: c(0) } as const;
    expect(simFigure(cs, { remaining: c(-20_00) })).toMatchObject({ label: "Passa do teto" });
  });
});
