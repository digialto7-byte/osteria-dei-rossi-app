import { describe, expect, it } from "vitest";
import { parseDecimal } from "@/lib/numbers/parse-decimal";

describe("parseDecimal", () => {
  it.each([
    ["12", 12],
    ["12,5", 12.5],
    ["12.5", 12.5],
    [" 0,0001 ", 0.0001],
    ["1234,5678", 1234.5678],
  ])("reads %j as %d", (text, value) => {
    expect(parseDecimal(text)).toEqual({ ok: true, value });
  });

  it("reads an empty field as no value", () => {
    expect(parseDecimal("")).toEqual({ ok: true, value: null });
    expect(parseDecimal("   ")).toEqual({ ok: true, value: null });
  });

  it.each(["abc", "-1", "1,2,3", "1,23456", "1e3", "1.234,5", ",5", "5,"])("rejects %j", (text) => {
    expect(parseDecimal(text)).toEqual({ ok: false });
  });
});
