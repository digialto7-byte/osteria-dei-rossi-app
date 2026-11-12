import { describe, expect, it } from "vitest";
import { formatWeight } from "@/lib/format/weight";

// Intl puts a no-break space before the unit; compare with a plain one.
const plain = (text: string) => text.replaceAll(" ", " ");

describe("formatWeight", () => {
  it("writes grams below one kilogram", () => {
    expect(plain(formatWeight(250))).toBe("250 g");
    expect(plain(formatWeight(50))).toBe("50 g");
    expect(plain(formatWeight(990))).toBe("990 g");
  });

  it("writes kilograms from 1 000 g, dropping trailing zeros", () => {
    expect(plain(formatWeight(1000))).toBe("1 kg");
    expect(plain(formatWeight(1200))).toBe("1,2 kg");
    expect(plain(formatWeight(1250))).toBe("1,25 kg");
    expect(plain(formatWeight(1210))).toBe("1,21 kg");
    expect(plain(formatWeight(3000))).toBe("3 kg");
  });

  it("keeps up to three decimals", () => {
    expect(plain(formatWeight(1005))).toBe("1,005 kg");
    expect(plain(formatWeight(10000))).toBe("10 kg");
  });

  it("can be asked for two decimals (the items report), rounding half up", () => {
    expect(plain(formatWeight(1225, "it", { kgDecimals: 2 }))).toBe("1,23 kg");
    expect(plain(formatWeight(2450, "it", { kgDecimals: 2 }))).toBe("2,45 kg");
    expect(plain(formatWeight(1004, "it", { kgDecimals: 2 }))).toBe("1 kg");
    expect(plain(formatWeight(250, "it", { kgDecimals: 2 }))).toBe("250 g");
  });

  it("writes English decimals for the second locale", () => {
    expect(plain(formatWeight(1200, "en"))).toBe("1.2 kg");
    expect(plain(formatWeight(250, "en"))).toBe("250 g");
  });

  it("rejects values that are not finite non-negative numbers", () => {
    expect(() => formatWeight(Number.NaN)).toThrow(RangeError);
    expect(() => formatWeight(-1)).toThrow(RangeError);
  });
});
