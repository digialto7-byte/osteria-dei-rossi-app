// Fake extraction data (invented supplier, lines and prices) shared by the extraction tests.
import type { ExtractedLine, InvoiceExtraction } from "@/server/extraction/schema";

export type LineData = ExtractedLine;
export type ExtractionData = Omit<InvoiceExtraction, "lines"> & {
  lines: [LineData, LineData, ...LineData[]];
};

const LINE_FIELDS = [
  "description",
  "supplier_code",
  "qty",
  "unit",
  "unit_price",
  "line_amount",
  "vat_rate",
  "lot_code",
  "expiry",
];
const HEADER_FIELDS = [
  "supplier_name",
  "supplier_vat",
  "invoice_number",
  "invoice_date",
  "due_date",
  "payment_terms",
  "net_total",
  "vat_total",
  "gross_total",
];
export const confidenceOf = <T>(fields: string[], value = 0.95) =>
  Object.fromEntries(fields.map((f) => [f, value])) as T;

/** 10.00 + 20.00 lines, VAT 3.00 (rate 10), gross 33.00. */
export function validExtraction(): ExtractionData {
  return {
    supplier_name: "Fornitore Demo Srl",
    supplier_vat: "IT12345678903",
    invoice_number: "FT 1/2026",
    invoice_date: "2026-10-15",
    due_date: "2026-11-15",
    payment_terms: "30 giorni data fattura",
    net_total: 30,
    vat_total: 3,
    gross_total: 33,
    lines: [
      {
        description: "Prodotto di prova A",
        supplier_code: "A-1",
        qty: 2,
        unit: "kg",
        unit_price: 5,
        line_amount: 10,
        vat_rate: 10,
        lot_code: "L-0425",
        expiry: "2026-11-30",
        confidence: confidenceOf<LineData["confidence"]>(LINE_FIELDS),
      },
      {
        description: "Prodotto di prova B",
        supplier_code: null,
        qty: 4,
        unit: "pz",
        unit_price: 5,
        line_amount: 20,
        vat_rate: 10,
        lot_code: null,
        expiry: null,
        confidence: confidenceOf<LineData["confidence"]>(LINE_FIELDS),
      },
    ],
    confidence: confidenceOf<ExtractionData["confidence"]>(HEADER_FIELDS),
  };
}
