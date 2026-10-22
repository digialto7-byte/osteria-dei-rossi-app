import { describe, expect, it } from "vitest";
import { formatNumber, formatQty } from "@/lib/units";

// A no-break space keeps the unit on the same line as the number, as with euro amounts.
const NBSP = " ";

describe("formatQty", () => {
  it("formats Italian decimals and grouping", () => {
    expect(formatQty(0.5, "kg")).toBe(`0,5${NBSP}kg`);
    expect(formatQty(1234.5, "kg")).toBe(`1.234,5${NBSP}kg`);
    expect(formatQty(3, "pz")).toBe(`3${NBSP}pz`);
  });

  it("shows at most 3 decimals", () => {
    expect(formatQty(0.0001, "kg")).toBe(`0${NBSP}kg`);
    expect(formatQty(1.23456, "l")).toBe(`1,235${NBSP}l`);
  });

  it("formats in English for the second locale", () => {
    expect(formatQty(1234.5, "kg", "en")).toBe(`1,234.5${NBSP}kg`);
  });

  it("counts whole packs", () => {
    expect(formatQty(3, "conf")).toBe(`3${NBSP}conf`);
  });
});

describe("formatNumber", () => {
  it("uses the quantity rules without a unit", () => {
    expect(formatNumber(1234.5)).toBe("1.234,5");
    expect(formatNumber(5.5)).toBe("5,5");
    expect(formatNumber(1234.5, "en")).toBe("1,234.5");
  });
});
