import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isValidItVat, normaliseItVat } from "@/lib/vat/it-vat";
import { parseExpected } from "./compare";

// The committed sample invoices are compared with the extraction after runChecks, which stores an
// Italian VAT number as IT + 11 digits. An expected file in any other form would report a correct
// extraction as a mismatch on every live run.
const dir = join(process.cwd(), "tests/contract/invoices");
const expectedFiles = readdirSync(dir).filter((name) => name.endsWith(".expected.json"));

describe("committed contract invoices", () => {
  it("has at least one sample", () => {
    expect(expectedFiles.length).toBeGreaterThan(0);
  });

  it.each(expectedFiles)("%s parses and keeps the VAT number in normalised form", (name) => {
    const expected = parseExpected(JSON.parse(readFileSync(join(dir, name), "utf8")));
    const vat = expected.supplier_vat;
    if (vat === undefined || vat === null) return;
    if (/^\d{11}$/.test(vat) || vat.startsWith("IT")) {
      expect(vat).toBe(normaliseItVat(vat));
      expect(isValidItVat(vat)).toBe(true);
    }
  });
});
