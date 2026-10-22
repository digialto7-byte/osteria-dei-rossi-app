import { describe, expect, it } from "vitest";
import { validExtraction } from "../helpers/extraction-data";
import {
  MAX_MODEL_CALL_MS,
  compareInvoice,
  parseExpected,
  renderSummary,
  summarise,
  type InvoiceResult,
} from "./compare";

const field = (results: { field: string; match: boolean }[], name: string) =>
  results.find((result) => result.field === name);

describe("compareInvoice", () => {
  it("compares strings after trim and case-fold", () => {
    const results = compareInvoice(
      { supplier_name: "Fornitore Demo Srl", invoice_number: "FT 1/2026" },
      { ...validExtraction(), supplier_name: "  FORNITORE demo srl ", invoice_number: "FT 2/2026" },
    );
    expect(field(results, "supplier_name")?.match).toBe(true);
    expect(field(results, "invoice_number")?.match).toBe(false);
  });

  it("compares amounts to the cent and dates exactly", () => {
    const base = validExtraction();
    const results = compareInvoice(
      { gross_total: 33.06, vat_total: 3, invoice_date: "2026-10-15", due_date: "2026-11-15" },
      { ...base, gross_total: 33.0600001, vat_total: 3.01, due_date: "2026-11-16" },
    );
    expect(field(results, "gross_total")?.match).toBe(true);
    expect(field(results, "vat_total")?.match).toBe(false);
    expect(field(results, "invoice_date")?.match).toBe(true);
    expect(field(results, "due_date")?.match).toBe(false);
  });

  it("null matches null only, and fields the expected file leaves out are not compared", () => {
    const results = compareInvoice(
      { payment_terms: null },
      { ...validExtraction(), payment_terms: null },
    );
    expect(results).toEqual([{ field: "payment_terms", match: true }]);
    expect(
      field(compareInvoice({ payment_terms: null }, validExtraction()), "payment_terms")?.match,
    ).toBe(false);
  });

  it("compares lines by position, plus the line count", () => {
    const results = compareInvoice(
      {
        lines: [
          { description: "prodotto di prova a", unit_price: 5, lot_code: "L-0425" },
          { qty: 9 },
        ],
      },
      validExtraction(),
    );
    expect(field(results, "lines.count")?.match).toBe(true);
    expect(field(results, "lines.description")?.match).toBe(true);
    expect(field(results, "lines.unit_price")?.match).toBe(true);
    expect(field(results, "lines.lot_code")?.match).toBe(true);
    expect(results.filter((r) => r.field === "lines.qty")).toEqual([
      { field: "lines.qty", match: false },
    ]);
  });

  it("a missing actual line fails the count and every field expected on it", () => {
    const actual = { ...validExtraction(), lines: validExtraction().lines.slice(0, 1) };
    const results = compareInvoice({ lines: [{ qty: 2 }, { qty: 4 }] }, actual);
    expect(field(results, "lines.count")?.match).toBe(false);
    expect(results.filter((r) => r.field === "lines.qty").map((r) => r.match)).toEqual([
      true,
      false,
    ]);
  });
});

describe("parseExpected", () => {
  it("accepts a partial expected file and rejects unknown keys", () => {
    expect(parseExpected({ gross_total: 1 })).toEqual({ gross_total: 1 });
    expect(() => parseExpected({ gross_totl: 1 })).toThrow();
    expect(() => parseExpected({ lines: [{ qtyy: 1 }] })).toThrow();
  });
});

const result = (
  name: string,
  fields: [string, boolean][],
  durationMs = 1000,
  ok = true,
): InvoiceResult => ({
  name,
  ok,
  durationMs,
  fields: fields.map(([f, match]) => ({ field: f, match })),
});

describe("summarise", () => {
  const two = [
    result("a", [
      ["gross_total", true],
      ["supplier_name", true],
      ["invoice_date", false],
    ]),
    result(
      "b",
      [
        ["gross_total", false],
        ["supplier_name", true],
        ["invoice_date", false],
      ],
      2500,
    ),
  ];

  it("gives per-field accuracy over the results", () => {
    const summary = summarise(two);
    expect(summary.fields).toEqual([
      { field: "gross_total", total: 2, matched: 1, accuracyPct: 50 },
      { field: "supplier_name", total: 2, matched: 2, accuracyPct: 100 },
      { field: "invoice_date", total: 2, matched: 0, accuracyPct: 0 },
    ]);
    expect(summary.invoices.map((i) => [i.name, i.durationMs])).toEqual([
      ["a", 1000],
      ["b", 2500],
    ]);
    expect(summary.passed).toBe(true);
    expect(summary.problems).toEqual([]);
  });

  it("rounds accuracy to one decimal", () => {
    const three = [
      result("a", [["x", true]]),
      result("b", [["x", false]]),
      result("c", [["x", false]]),
    ];
    expect(summarise(three).fields[0]?.accuracyPct).toBe(33.3);
  });

  it("fails when any model call takes 60 s or more", () => {
    expect(MAX_MODEL_CALL_MS).toBe(60_000);
    expect(summarise([result("a", [["x", true]], 59_999)]).passed).toBe(true);
    const slow = summarise([result("a", [["x", true]], 60_000)]);
    expect(slow.passed).toBe(false);
    expect(slow.problems).toEqual(["a: model call took 60000 ms (limit 60000 ms)"]);
  });

  it("fails when an invoice did not pass the schema, and does not count its fields", () => {
    const summary = summarise([result("a", [], 1000, false), result("b", [["x", true]])]);
    expect(summary.passed).toBe(false);
    expect(summary.problems).toEqual(["a: extraction failed"]);
    expect(summary.fields).toEqual([{ field: "x", total: 1, matched: 1, accuracyPct: 100 }]);
  });
});

describe("renderSummary", () => {
  it("shows field names, yes/no and milliseconds, never values", () => {
    const secretLooking = "Trattoria Segretissima 99,99";
    const summary = summarise([
      {
        name: "fattura-1",
        ok: true,
        durationMs: 1234,
        fields: [{ field: "supplier_name", match: false }],
      },
    ]);
    const text = renderSummary(summary);
    expect(text).toContain("supplier_name");
    expect(text).toContain("fattura-1");
    expect(text).toContain("1234 ms");
    expect(text).toContain("0%");
    expect(text).not.toContain(secretLooking);
    expect(text).toMatch(/Esito: (non )?superato/i);
  });
});
