import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseEuroInput } from "@/lib/money/parse";

describe("parseEuroInput", () => {
  it.each([
    ["1.234,50", "1234.50"],
    ["1234,5", "1234.50"],
    ["1234.50", "1234.50"],
    ["1234", "1234.00"],
    ["0", "0.00"],
    ["0,5", "0.50"],
    ["12,05", "12.05"],
    ["  1.222,00 ", "1222.00"],
    ["1.222.333,44", "1222333.44"],
    ["9999999,99", "9999999.99"],
    ["007", "7.00"],
    ["12.5", "12.50"],
  ])("%j becomes the decimal string %j", (text, expected) => {
    expect(parseEuroInput(text)).toBe(expected);
  });

  it.each([
    ["12,345"],
    ["1.23.4"],
    ["abc"],
    [""],
    ["   "],
    ["-5"],
    ["+5"],
    ["10000000"],
    ["10000000,00"],
    ["1,2,3"],
    ["1.234"],
    [","],
    ["."],
    [",5"],
    ["5,"],
    ["1 234,50"],
    ["1e3"],
    ["1..234,50"],
    ["12.345,6.7"],
  ])("%j is not an amount", (text) => {
    expect(parseEuroInput(text)).toBeNull();
  });

  it("uses no Number, parseFloat or arithmetic: the value stays a string from the keyboard to the server", () => {
    const source = readFileSync(
      new URL("../../../src/lib/money/parse.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/\bNumber\s*\(|parseFloat|parseInt|Math\.|\+\s*"|\*\s*100/);
  });
});
