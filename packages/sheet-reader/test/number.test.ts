import { describe, expect, it } from "vitest";
import { parseNumber } from "../src/index.ts";

describe("parseNumber (v1 test_parse_number_separator_rules)", () => {
  it.each([
    ["1.234,56", 123456],
    ["3,012.73", 301273],
    ["R$ 1.234,56", 123456],
    ["3.012", 301200],
    ["1.234.567", 123456700],
    ["1370,5", 137050],
    ["12.34", 1234],
    ["5678.1234", 567812],
    ["-45,00", -4500],
    ["(1.234,56)", -123456],
    ["(R$ 1.000,00)", -100000],
    ["R$ 0,00", 0],
  ])("%s → %d", (input, expected) => {
    expect(parseNumber(input)).toBe(expected);
  });
  it("returns null without digits", () => {
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("abc")).toBeNull();
  });
});
