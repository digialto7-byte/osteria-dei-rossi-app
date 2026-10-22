import { z } from "zod";
import { decimals4 } from "@/lib/numbers/decimals";
import { MAX_DESCRIPTION_CHARS, MAX_EXTRACTED_LINES } from "@/server/extraction/constants";

// What the model must return. Absent values are null, never omitted. No enums (their casing
// drifts). Zod enforces every limit after the call; the wire form drops the ones the API rejects.

const amount = (max: number) => z.number().min(0).max(max).refine(decimals4, "at most 4 decimals");
const text = (max: number) => z.string().min(1).max(max);
const confidence = z.number().min(0).max(1);

const lineConfidence = z.strictObject({
  description: confidence,
  supplier_code: confidence,
  qty: confidence,
  unit: confidence,
  unit_price: confidence,
  line_amount: confidence,
  vat_rate: confidence,
  lot_code: confidence,
  expiry: confidence,
});

const headerConfidence = z.strictObject({
  supplier_name: confidence,
  supplier_vat: confidence,
  invoice_number: confidence,
  invoice_date: confidence,
  due_date: confidence,
  payment_terms: confidence,
  net_total: confidence,
  vat_total: confidence,
  gross_total: confidence,
});

const line = z.strictObject({
  description: text(MAX_DESCRIPTION_CHARS),
  supplier_code: text(64).nullable(),
  qty: amount(1e6),
  unit: text(20).nullable(),
  unit_price: amount(1e6).nullable(),
  line_amount: amount(1e6),
  vat_rate: z.number().min(0).max(100).refine(decimals4).nullable(),
  lot_code: text(64).nullable(),
  expiry: z.iso.date().nullable(),
  confidence: lineConfidence,
});

export const InvoiceExtraction = z.strictObject({
  supplier_name: text(200).nullable(),
  supplier_vat: text(64).nullable(),
  invoice_number: text(64).nullable(),
  invoice_date: z.iso.date().nullable(),
  due_date: z.iso.date().nullable(),
  payment_terms: text(200).nullable(),
  net_total: amount(1e7).nullable(),
  vat_total: amount(1e7).nullable(),
  gross_total: amount(1e7).nullable(),
  lines: z.array(line).max(MAX_EXTRACTED_LINES),
  confidence: headerConfidence,
});

export type InvoiceExtraction = z.infer<typeof InvoiceExtraction>;
export type ExtractedLine = InvoiceExtraction["lines"][number];

// Keywords the structured-output API rejects.
const UNSUPPORTED = new Set([
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
]);

function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (node === null || typeof node !== "object") return node;
  const entries = Object.entries(node as Record<string, unknown>)
    .filter(([key]) => !UNSUPPORTED.has(key))
    .map(([key, value]) => [key, strip(value)] as const);
  const out: Record<string, unknown> = Object.fromEntries(entries);
  if (out.type === "object") out.additionalProperties = false;
  return out;
}

/** The JSON schema sent as `output_config.format.schema`. */
export function toWireSchema(): Record<string, unknown> {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(InvoiceExtraction) as Record<
    string,
    unknown
  >;
  return strip(schema) as Record<string, unknown>;
}
