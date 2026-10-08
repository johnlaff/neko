import { describe, expect, it } from "vitest";
import { closesIn } from "../src/web/format.ts";

describe("closesIn", () => {
  it("counts today in closesInDays: 1 is today, 2 tomorrow", () => {
    expect(closesIn(1)).toBe("Fecha hoje");
    expect(closesIn(2)).toBe("Fecha amanhã");
    expect(closesIn(4)).toBe("Fecha em 3 dias");
  });
});
