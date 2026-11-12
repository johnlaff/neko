import { describe, expect, it } from "vitest";
import { ScenarioBody } from "../src/worker/scenario.ts";

describe("Simular's request", () => {
  it("takes what the Android app sends when nothing is changed yet", () => {
    // kotlinx.serialization leaves out fields at their default: ScenarioBody() is `{}`.
    expect(ScenarioBody.parse({})).toEqual({ changes: [] });
    expect(ScenarioBody.parse({ pace: "teto" })).toEqual({ pace: "teto", changes: [] });
  });

  it("still refuses what it cannot read", () => {
    expect(ScenarioBody.safeParse({ pace: "rapido" }).success).toBe(false);
    expect(
      ScenarioBody.safeParse({ changes: [{ kind: "compra", amount: 0, count: 1 }] }).success,
    ).toBe(false);
  });
});
