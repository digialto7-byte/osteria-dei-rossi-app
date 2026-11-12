import { describe, expect, it } from "vitest";
import { formatEuro, formatPricePerEtto } from "@/lib/money/format";

const plain = (text: string) => text.replaceAll(" ", " ");

describe("formatPricePerEtto", () => {
  it("writes the price per 100 g, built on formatEuro", () => {
    expect(plain(formatPricePerEtto(9))).toBe("9,00 € / 100 g");
    expect(formatPricePerEtto(4.25)).toBe(`${formatEuro(4.25)} / 100 g`);
  });

  it("writes the English form for the second locale", () => {
    expect(plain(formatPricePerEtto(9, "en"))).toBe("€9.00 / 100 g");
  });

  it("rejects a non-finite price like formatEuro does", () => {
    expect(() => formatPricePerEtto(Number.NaN)).toThrow(RangeError);
  });
});
