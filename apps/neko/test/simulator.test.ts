import { type Cents, cents } from "@neko/engine";
import { describe, expect, it } from "vitest";
import { simFigure } from "../src/web/Pace.tsx";

const c = (n: number): Cents => cents(n);

describe("simulator figure", () => {
  it("before a value is typed, a card already over the plan says by how much, not a negative per day", () => {
    expect(simFigure({ perDay: c(-50_00), overBy: c(750_31) }, null)).toEqual({
      label: "Passa do plano",
      amount: 750_31,
      over: true,
    });
    expect(simFigure({ perDay: c(120_00), overBy: c(0) }, null)).toEqual({
      label: "Sobra por dia",
      amount: 120_00,
      over: false,
    });
  });

  it("with a purchase typed, speaks for the cycle after it", () => {
    const cs = { perDay: c(120_00), overBy: c(0) };
    expect(simFigure(cs, { perDay: c(80_00), remaining: c(800_00) })).toMatchObject({
      label: "Sobra por dia",
      amount: 80_00,
    });
    expect(simFigure(cs, { perDay: c(-10_00), remaining: c(-300_00) })).toMatchObject({
      label: "Passa do plano",
      amount: 300_00,
    });
  });
});
