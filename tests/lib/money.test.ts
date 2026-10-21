import { describe, expect, it } from "vitest";
import { formatEuro } from "@/lib/money/format";

// Intl separates the amount and the € sign with a no-break space, so the sign never wraps alone.
const NBSP = " ";

describe("formatEuro", () => {
  it("formats thousands with a dot and decimals with a comma", () => {
    expect(formatEuro(1234.5)).toBe(`1.234,50${NBSP}€`);
  });

  it("groups four-digit amounts too (it-IT would not by default)", () => {
    expect(formatEuro(1000)).toBe(`1.000,00${NBSP}€`);
  });

  it("always shows two decimals and rounds half away from zero to cents", () => {
    expect(formatEuro(0)).toBe(`0,00${NBSP}€`);
    expect(formatEuro(2.005)).toBe(`2,01${NBSP}€`);
  });

  it("formats negative amounts", () => {
    expect(formatEuro(-12.3)).toBe(`-12,30${NBSP}€`);
  });

  it("formats in English for the second locale", () => {
    expect(formatEuro(1234.5, "en")).toBe("€1,234.50");
  });

  it("rejects non-finite numbers instead of printing NaN", () => {
    expect(() => formatEuro(Number.NaN)).toThrow(RangeError);
    expect(() => formatEuro(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
