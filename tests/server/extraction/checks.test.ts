import { describe, expect, it } from "vitest";
import { runChecks, totalsGate } from "@/server/extraction/checks";
import { validExtraction, type ExtractionData } from "../../helpers/extraction-data";

const lines = (...amounts: number[]) => amounts.map((line_amount) => ({ line_amount }));

describe("totalsGate (AT2)", () => {
  it("flags a 0.06 mismatch and reports the diff", () => {
    const gate = totalsGate(lines(10, 20), 3, 33.06);
    expect(gate.flagged).toBe(true);
    expect(gate.diff).toBeCloseTo(-0.06, 10);
  });

  it.each([
    [33.05, false],
    [32.95, false],
    [32.94, true],
    [33, false],
  ])("gross %f -> flagged %s", (gross, flagged) => {
    expect(totalsGate(lines(10, 20), 3, gross).flagged).toBe(flagged);
  });

  it("is not fooled by float sums (0.1 + 0.2 = 0.30)", () => {
    const gate = totalsGate(lines(0.1, 0.2), 0, 0.3);
    expect(gate).toEqual({ flagged: false, diff: 0 });
  });

  it("flags a missing gross or VAT total with a null diff", () => {
    expect(totalsGate(lines(10), 1, null)).toEqual({ flagged: true, diff: null });
    expect(totalsGate(lines(10), null, 11)).toEqual({ flagged: true, diff: null });
  });

  it("handles no lines", () => {
    expect(totalsGate([], 0, 0)).toEqual({ flagged: false, diff: 0 });
  });
});

const run = (patch: Partial<ExtractionData> = {}) => runChecks({ ...validExtraction(), ...patch });

describe("runChecks", () => {
  it("passes a clean invoice with no flags", () => {
    const result = run();
    expect(result.gateFlags).toEqual([]);
    expect(result.totalsDiff).toBe(0);
    expect(result.lineChecks).toEqual([[], []]);
  });

  it("reports total_mismatch from the gate", () => {
    const result = run({ gross_total: 33.06 });
    expect(result.gateFlags).toEqual(["total_mismatch"]);
    expect(result.totalsDiff).toBeCloseTo(-0.06, 10);
  });

  describe("VAT number", () => {
    it.each([
      ["12345678903", "IT12345678903"],
      ["IT 123.456.789.03", "IT12345678903"],
      ["it12345678903", "IT12345678903"],
    ])("%j -> %s", (raw, expected) => {
      expect(run({ supplier_vat: raw }).data.supplier_vat).toBe(expected);
    });

    it("nulls a bad checksum and caps its confidence", () => {
      const result = run({ supplier_vat: "IT12345678904" });
      expect(result.data.supplier_vat).toBeNull();
      expect(result.data.confidence.supplier_vat).toBeLessThanOrEqual(0.3);
      expect(result.gateFlags).toContain("low_confidence");
    });

    it("keeps a plausible foreign VAT and nulls garbage", () => {
      expect(run({ supplier_vat: "DE 123456789" }).data.supplier_vat).toBe("DE123456789");
      expect(run({ supplier_vat: "not a vat" }).data.supplier_vat).toBeNull();
    });

    it("leaves a null VAT alone with its confidence", () => {
      const data = { ...validExtraction(), supplier_vat: null };
      const result = runChecks(data);
      expect(result.data.supplier_vat).toBeNull();
      expect(result.data.confidence.supplier_vat).toBe(0.95);
    });
  });

  describe("line checks", () => {
    const withLine = (patch: Record<string, unknown>) => {
      const data = validExtraction();
      Object.assign(data.lines[0], patch);
      return runChecks(data);
    };

    it("accepts 2 x 4.99 vs 9.99 (within 0.05) and flags 10.05 as amount_mismatch", () => {
      expect(withLine({ qty: 2, unit_price: 4.99, line_amount: 9.99 }).lineChecks[0]).toEqual([]);
      const bad = withLine({ qty: 2, unit_price: 4.99, line_amount: 10.05 });
      expect(bad.lineChecks[0]).toEqual(["amount_mismatch"]);
      expect(bad.data.lines[0]?.confidence.line_amount).toBeLessThanOrEqual(0.3);
    });

    it("skips the amount check without a unit price", () => {
      expect(withLine({ unit_price: null, line_amount: 99 }).lineChecks[0]).toEqual([]);
    });

    it("flags an unexpected VAT rate and caps its confidence", () => {
      const result = withLine({ vat_rate: 7 });
      expect(result.lineChecks[0]).toEqual(["vat_rate_unexpected"]);
      expect(result.data.lines[0]?.confidence.vat_rate).toBeLessThanOrEqual(0.3);
      expect(result.gateFlags).toContain("low_confidence");
    });

    it("accepts a null VAT rate and every allowed rate", () => {
      expect(withLine({ vat_rate: null }).lineChecks[0]).toEqual([]);
      for (const rate of [0, 4, 5, 10, 22]) {
        expect(withLine({ vat_rate: rate }).lineChecks[0]).toEqual([]);
      }
    });

    it("can carry both checks", () => {
      const result = withLine({ vat_rate: 7, qty: 1, unit_price: 1, line_amount: 5 });
      expect(result.lineChecks[0]).toEqual(["amount_mismatch", "vat_rate_unexpected"]);
    });
  });

  describe("low_confidence", () => {
    it("flags any confidence below 0.8, header or line", () => {
      const header = validExtraction();
      header.confidence.invoice_date = 0.79;
      expect(runChecks(header).gateFlags).toEqual(["low_confidence"]);
      const line = validExtraction();
      line.lines[1].confidence.qty = 0.79;
      expect(runChecks(line).gateFlags).toEqual(["low_confidence"]);
    });

    it("does not flag exactly 0.8", () => {
      const data = validExtraction();
      data.confidence.invoice_date = 0.8;
      expect(runChecks(data).gateFlags).toEqual([]);
    });

    it("lists both flags in a fixed order", () => {
      const data = validExtraction();
      data.gross_total = 40;
      data.confidence.invoice_date = 0.1;
      expect(runChecks(data).gateFlags).toEqual(["total_mismatch", "low_confidence"]);
    });
  });

  describe("string normalisation", () => {
    it("removes bidi and control characters, trims and applies NFC", () => {
      const data = validExtraction();
      data.lines[0].description = "  Café‮\u0000 tostato‏  ";
      data.supplier_name = "⁦Fornitore⁩ Demo\n";
      const result = runChecks(data);
      expect(result.data.lines[0]?.description).toBe("Café tostato");
      expect(result.data.supplier_name).toBe("Fornitore Demo");
    });

    it("turns blank optional strings into null", () => {
      const data = validExtraction();
      data.payment_terms = " ‮ ";
      data.lines[1].lot_code = "";
      const result = runChecks(data);
      expect(result.data.payment_terms).toBeNull();
      expect(result.data.lines[1]?.lot_code).toBeNull();
    });

    it("keeps a description that cleans to nothing storable and flags it", () => {
      const data = validExtraction();
      data.lines[0].description = "‮\u0000";
      const result = runChecks(data);
      expect(result.data.lines[0]?.description.length).toBeGreaterThan(0);
      expect(result.gateFlags).toContain("low_confidence");
    });

    it("does not mutate its input", () => {
      const data = validExtraction();
      data.supplier_vat = "12345678903";
      runChecks(data);
      expect(data.supplier_vat).toBe("12345678903");
    });
  });
});
