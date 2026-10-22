// Fake extraction data (invented supplier, lines and prices) shared by the extraction tests.
export interface LineData {
  description: string;
  supplier_code: string | null;
  qty: number;
  unit: string | null;
  unit_price: number | null;
  line_amount: number;
  vat_rate: number | null;
  lot_code: string | null;
  expiry: string | null;
  confidence: Record<string, number>;
}

export interface ExtractionData {
  supplier_name: string | null;
  supplier_vat: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  payment_terms: string | null;
  net_total: number | null;
  vat_total: number | null;
  gross_total: number | null;
  lines: [LineData, LineData, ...LineData[]];
  confidence: Record<string, number>;
}

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
export const confidenceOf = (fields: string[], value = 0.95) =>
  Object.fromEntries(fields.map((f) => [f, value]));

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
        confidence: confidenceOf(LINE_FIELDS),
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
        confidence: confidenceOf(LINE_FIELDS),
      },
    ],
    confidence: confidenceOf(HEADER_FIELDS),
  };
}
