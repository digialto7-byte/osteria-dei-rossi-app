import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EST_CHARS_PER_OUTPUT_TOKEN,
  EST_HEADER_OUTPUT_TOKENS,
  EST_OUTPUT_TOKENS_PER_LINE,
  EXTRACTION_MAX_TOKENS,
  MAX_EXTRACTED_LINES,
} from "@/server/extraction/constants";
import { classifyResponse } from "@/server/extraction/outcome";
import { InvoiceExtraction } from "@/server/extraction/schema";
import { validExtraction } from "../../helpers/extraction-data";

// The output budget must hold the largest invoice the schema accepts; otherwise an invoice the
// schema allows always ends in output_truncated. max_tokens is a ceiling: only generated tokens
// are billed, so a higher ceiling costs nothing on an invoice that fits.

interface ExpectedLine {
  description: string;
  qty: number;
  unit: string | null;
  unit_price: number | null;
  line_amount: number;
  vat_rate: number | null;
}

const at8 = JSON.parse(
  readFileSync(
    join(__dirname, "../../contract/invoices/fornitore-ortofrutta-01.expected.json"),
    "utf8",
  ),
) as { lines: ExpectedLine[] };

const confidence = () => validExtraction().lines[0].confidence;

/** What the model returns for one AT8 line: every field, nulls included, nine confidences. */
const at8Lines = () =>
  at8.lines.map((line) => ({
    description: line.description,
    supplier_code: null,
    qty: line.qty,
    unit: line.unit,
    unit_price: line.unit_price,
    line_amount: line.line_amount,
    vat_rate: line.vat_rate,
    lot_code: null,
    expiry: null,
    confidence: confidence(),
  }));

/** A heavier line than AT8 has: every field filled, a 60-character description. */
const fullLine = () => ({
  description: "FILETTO DI BRANZINO ATLANTICO FRESCO SFUSO CAL. 300-400 G. X",
  supplier_code: "ART-0012345",
  qty: 12.375,
  unit: "KG",
  unit_price: 18.4567,
  line_amount: 228.4017,
  vat_rate: 10,
  lot_code: "L2026-0915-A",
  expiry: "2026-10-30",
  confidence: confidence(),
});

// Compact and pretty-printed (two-space) JSON: the API does not promise either.
const tokens = (value: unknown, indent?: number) =>
  Math.ceil(JSON.stringify(value, null, indent).length / EST_CHARS_PER_OUTPUT_TOKEN);

describe("extraction output budget", () => {
  it("holds the header and MAX_EXTRACTED_LINES lines", () => {
    expect(
      EST_HEADER_OUTPUT_TOKENS + MAX_EXTRACTED_LINES * EST_OUTPUT_TOKENS_PER_LINE,
    ).toBeLessThanOrEqual(EXTRACTION_MAX_TOKENS);
  });

  it("the per-line estimate covers every AT8 line, compact or pretty-printed", () => {
    const lines = at8Lines();
    expect(lines).toHaveLength(82);
    expect(InvoiceExtraction.safeParse({ ...validExtraction(), lines }).success).toBe(true);
    for (const line of lines) {
      expect(tokens(line)).toBeLessThanOrEqual(EST_OUTPUT_TOKENS_PER_LINE);
      expect(tokens(line, 2)).toBeLessThanOrEqual(EST_OUTPUT_TOKENS_PER_LINE);
    }
  });

  it("and a line with every field filled", () => {
    const line = fullLine();
    expect(InvoiceExtraction.safeParse({ ...validExtraction(), lines: [line] }).success).toBe(true);
    expect(tokens(line, 2)).toBeLessThanOrEqual(EST_OUTPUT_TOKENS_PER_LINE);
  });

  it("the header estimate covers a full header", () => {
    const { lines: _lines, ...header } = validExtraction();
    expect(tokens(header, 2)).toBeLessThanOrEqual(EST_HEADER_OUTPUT_TOKENS);
  });
});

describe("an invoice over MAX_EXTRACTED_LINES", () => {
  const reply = (lineCount: number, patch: Record<string, unknown> = {}) => {
    const data = validExtraction();
    data.lines = Array.from({ length: lineCount }, () => data.lines[0]) as typeof data.lines;
    return {
      stop_reason: "end_turn" as const,
      content: [
        { type: "text" as const, text: JSON.stringify({ ...data, ...patch }), citations: null },
      ],
    };
  };

  it("is output_truncated (the invoice is too long), not schema_invalid", () => {
    expect(classifyResponse(reply(MAX_EXTRACTED_LINES + 1))).toMatchObject({
      ok: false,
      code: "output_truncated",
      retryable: false,
    });
  });

  it("is read at exactly MAX_EXTRACTED_LINES", () => {
    expect(classifyResponse(reply(MAX_EXTRACTED_LINES))).toMatchObject({ ok: true });
  });

  it("but a too-long invoice that is also otherwise invalid stays schema_invalid", () => {
    const bad = reply(MAX_EXTRACTED_LINES + 1, { gross_total: -1 });
    expect(classifyResponse(bad)).toMatchObject({ ok: false, code: "schema_invalid" });
  });
});
