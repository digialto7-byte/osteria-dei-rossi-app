import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXTRACTION_LEASE_SECONDS, MAX_EXTRACTED_LINES } from "@/server/extraction/constants";
import { InvoiceExtraction, toWireSchema } from "@/server/extraction/schema";
import { validExtraction } from "../../helpers/extraction-data";

const parse = (value: unknown) => InvoiceExtraction.safeParse(value);
const withLine = (patch: Record<string, unknown>) => {
  const data = validExtraction();
  Object.assign(data.lines[0], patch);
  return data;
};

describe("InvoiceExtraction", () => {
  it("accepts a valid extraction", () => {
    const result = parse(validExtraction());
    expect(result.success).toBe(true);
  });

  it("accepts nulls for absent optional values", () => {
    const data = validExtraction();
    Object.assign(data, { due_date: null, payment_terms: null, supplier_vat: null });
    Object.assign(data.lines[0], { lot_code: null, expiry: null, unit_price: null });
    expect(parse(data).success).toBe(true);
  });

  it("rejects an omitted field (absent means null)", () => {
    const data: Record<string, unknown> = { ...validExtraction() };
    delete data.due_date;
    expect(parse(data).success).toBe(false);
  });

  it("rejects an extra key at the top level (AT3)", () => {
    expect(parse({ ...validExtraction(), approved: true }).success).toBe(false);
  });

  it("rejects an extra key inside a line (AT3)", () => {
    expect(parse(withLine({ note: "x" })).success).toBe(false);
  });

  it("rejects an extra key inside confidence", () => {
    const data = validExtraction();
    Object.assign(data.confidence, { extra: 1 });
    expect(parse(data).success).toBe(false);
  });

  it("rejects a negative quantity (AT3)", () => {
    expect(parse(withLine({ qty: -1 })).success).toBe(false);
  });

  it("rejects a 600-character description and accepts 500 (AT3)", () => {
    expect(parse(withLine({ description: "a".repeat(600) })).success).toBe(false);
    expect(parse(withLine({ description: "a".repeat(500) })).success).toBe(true);
    expect(parse(withLine({ description: "" })).success).toBe(false);
  });

  it.each(["31/10/2026", "2026-02-30", "2026-1-5", ""])("rejects invoice_date %j", (date) => {
    expect(parse({ ...validExtraction(), invoice_date: date }).success).toBe(false);
  });

  it("rejects more than the allowed number of lines", () => {
    const data = validExtraction();
    const many = (n: number) => Array.from({ length: n }, () => data.lines[0]);
    data.lines = many(MAX_EXTRACTED_LINES + 1) as typeof data.lines;
    expect(parse(data).success).toBe(false);
    data.lines = many(MAX_EXTRACTED_LINES) as typeof data.lines;
    expect(parse(data).success).toBe(true);
  });

  it("rejects confidence above 1 or below 0", () => {
    const high = validExtraction();
    high.confidence.gross_total = 1.2;
    expect(parse(high).success).toBe(false);
    const low = validExtraction();
    low.lines[0].confidence.qty = -0.1;
    expect(parse(low).success).toBe(false);
  });

  it("rejects more than 4 decimals and out-of-range amounts", () => {
    expect(parse(withLine({ unit_price: 1.23456 })).success).toBe(false);
    expect(parse(withLine({ unit_price: 1.2345 })).success).toBe(true);
    expect(parse(withLine({ line_amount: 1_000_001 })).success).toBe(false);
    expect(parse({ ...validExtraction(), gross_total: 10_000_001 }).success).toBe(false);
    expect(parse(withLine({ vat_rate: 101 })).success).toBe(false);
  });

  it("rejects non-numbers and NaN-like values", () => {
    expect(parse(withLine({ qty: "2" })).success).toBe(false);
    expect(parse(withLine({ qty: Number.NaN })).success).toBe(false);
  });

  it("rejects over-long strings", () => {
    expect(parse({ ...validExtraction(), invoice_number: "x".repeat(65) }).success).toBe(false);
    expect(parse({ ...validExtraction(), supplier_name: "x".repeat(201) }).success).toBe(false);
    expect(parse({ ...validExtraction(), payment_terms: "x".repeat(201) }).success).toBe(false);
    expect(parse(withLine({ unit: "x".repeat(21) })).success).toBe(false);
  });
});

const STRIPPED = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "maxItems",
  "minItems",
];

function walk(node: unknown, visit: (obj: Record<string, unknown>) => void) {
  if (Array.isArray(node)) node.forEach((n) => walk(n, visit));
  else if (node && typeof node === "object") {
    visit(node as Record<string, unknown>);
    Object.values(node).forEach((n) => walk(n, visit));
  }
}

describe("toWireSchema", () => {
  const wire = toWireSchema();

  it("holds none of the keywords the API rejects", () => {
    const found: string[] = [];
    walk(wire, (obj) => found.push(...STRIPPED.filter((k) => k in obj)));
    expect(found).toEqual([]);
  });

  it("closes every object and requires every property", () => {
    let objects = 0;
    walk(wire, (obj) => {
      if (obj.type !== "object") return;
      objects++;
      expect(obj.additionalProperties).toBe(false);
      expect(obj.required).toEqual(Object.keys(obj.properties as object));
    });
    expect(objects).toBe(4); // root, header confidence, line, line confidence
  });

  it("does not mutate the Zod schema (limits still enforced)", () => {
    expect(parse(withLine({ qty: -1 })).success).toBe(false);
  });

  it("matches the snapshot", () => {
    expect(wire).toMatchSnapshot();
  });
});

describe("SQL lease default", () => {
  it("app.extraction_due() defaults to EXTRACTION_LEASE_SECONDS", () => {
    const dir = join(process.cwd(), "supabase/migrations");
    const file = readdirSync(dir).find((f) => f.endsWith("_cron_extract.sql"));
    expect(file).toBeDefined();
    const sql = readFileSync(join(dir, file as string), "utf8");
    const match =
      /function app\.extraction_due\(\s*p_lease_seconds\s+int\s+default\s+(\d+)\s*\)/.exec(sql);
    expect(Number(match?.[1])).toBe(EXTRACTION_LEASE_SECONDS);
  });
});
