import { describe, expect, it } from "vitest";
import { isValidItVat, itVatCheckDigit, normaliseItVat } from "@/lib/vat/it-vat";

// The same vectors are checked against app.is_valid_it_vat in pgTAP (006_master_functions).
const VALID = ["IT00000000000", "IT12345678903", "IT01234567897", "IT11111111115", "IT99999999990"];
const BAD_CHECKSUM = ["IT12345678901", "IT00000000001", "IT01234567890"];
const BAD_FORMAT = [
  "IT1234567890",
  "IT123456789012",
  "12345678903",
  "FR12345678903",
  "IT1234567890A",
  "",
];

describe("Italian VAT number (partita IVA)", () => {
  it.each(VALID)("%s is valid", (vat) => {
    expect(isValidItVat(vat)).toBe(true);
  });

  it.each(BAD_CHECKSUM)("%s fails the checksum", (vat) => {
    expect(isValidItVat(vat)).toBe(false);
  });

  it.each(BAD_FORMAT)("%j is not IT + 11 digits", (vat) => {
    expect(isValidItVat(vat)).toBe(false);
  });

  it("computes the check digit from the first 10 digits", () => {
    expect(itVatCheckDigit("1234567890")).toBe(3);
    expect(itVatCheckDigit("0123456789")).toBe(7);
    expect(() => itVatCheckDigit("123")).toThrow(RangeError);
  });

  it("normalises spacing and case before checking", () => {
    expect(normaliseItVat(" it 1234567890 3 ")).toBe("IT12345678903");
    expect(isValidItVat(normaliseItVat(" it 1234567890 3 "))).toBe(true);
  });

  it("does not accept a lower-case or spaced value without normalising", () => {
    expect(isValidItVat("it12345678903")).toBe(false);
  });
});
