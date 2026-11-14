import { describe, expect, it } from "vitest";
import {
  buildReview,
  type LotRow,
  type ReviewInvoiceRow,
  type ReviewLineRow,
  type ReviewSource,
} from "@/server/invoices/review";

// P2-2 S12 (plan §3.6, D-P11): the review reply says which stock lines have no lot code, so the screen only renders it. Fake data only.

const SUPPLIER_ID = "5a000000-0000-4000-8000-000000000001";
const ING = "1d000000-0000-4000-8000-000000000001";
const lineId = (n: number) => `11000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const invoice = (status: ReviewInvoiceRow["status"] = "review"): ReviewInvoiceRow => ({
  id: "1b000000-0000-4000-8000-0000000000b1",
  status,
  source: "upload",
  original_filename: "fattura.pdf",
  file_mime: "application/pdf",
  file_size_bytes: 80,
  supplier_vat: "IT12345678903",
  supplier_name: "Fornitore Demo Srl",
  number_raw: "FT 1/1998",
  invoice_date: "1998-10-01",
  due_date: "1998-11-15",
  net_total: 30,
  vat_total: 3,
  gross_total: 33,
  totals_diff: 0,
  gate_flags: [],
  extraction_error: null,
  attempts: 1,
  extracted_at: "1998-10-22T08:01:00+00:00",
  duplicate_of: null,
  duplicate_warning_of: null,
  created_at: "1998-10-22T08:00:00+00:00",
  supplier_id: SUPPLIER_ID,
  supplier_suggestion_id: null,
  header_corrected_fields: [],
  payment_terms: null,
  field_confidence: null,
});

const line = (position: number, over: Partial<ReviewLineRow> = {}): ReviewLineRow => ({
  id: lineId(position),
  position,
  sub_position: 0,
  parent_line_id: null,
  split_at: null,
  superseded_at: null,
  raw_description: `Articolo ${position}`,
  supplier_code: null,
  qty: 2,
  unit_raw: "kg",
  unit: "kg",
  unit_price: 5,
  line_amount: 10,
  vat_rate: 10,
  lot_code: null,
  expiry: null,
  is_stock: true,
  cost_centre_id: null,
  credit_qty: 0,
  ingredient_id: ING,
  supplier_item_id: null,
  mapping_source: "manual",
  suggested_ingredient_id: null,
  field_confidence: null,
  checks: [],
  corrected_fields: [],
  reviewed_at: null,
  ...over,
});

const source = (lines: ReviewLineRow[], over: Partial<ReviewSource> = {}): ReviewSource => ({
  invoice: invoice(),
  suppliers: [{ id: SUPPLIER_ID, name: "Fornitore Demo Srl", vat_number: "IT12345678903" }],
  lines,
  ingredients: [{ id: ING, name: "Farina Demo", base_unit: "kg" }],
  items: [],
  costCentres: [],
  ...over,
});

const missing = (review: ReturnType<typeof buildReview>) =>
  Object.fromEntries(review.lines.map((l) => [l.position, l.lotMissing]));

describe("lotMissing in the review reply (invoice in review)", () => {
  it("is true for a stock line without a lot code, false with one, false for a non-stock line", () => {
    const review = buildReview(
      source([
        line(1),
        line(2, { lot_code: "L-DEMO-0001" }),
        line(3, { is_stock: false, cost_centre_id: "cc000000-0000-4000-8000-000000000001" }),
      ]),
    );
    expect(missing(review)).toEqual({ 1: true, 2: false, 3: false });
  });

  it("counts stock lines without a lot: 2 on a 4-line fixture", () => {
    const review = buildReview(
      source([
        line(1),
        line(2),
        line(3, { lot_code: "L-DEMO-0003" }),
        line(4, { is_stock: false }),
      ]),
    );
    expect(review.summary.stockLinesWithoutLot).toBe(2);
    expect(review.summary.lines).toBe(4);
  });

  it("an unmapped stock line without a lot is marked too (the mark does not depend on the mapping)", () => {
    const review = buildReview(source([line(1, { ingredient_id: null, mapping_source: null })]));
    expect(review.lines[0]!.lotMissing).toBe(true);
    expect(review.summary.stockLinesWithoutLot).toBe(1);
  });

  it("a split parent is never marked and never counted; its parts carry the mark", () => {
    const review = buildReview(
      source([
        line(1, { split_at: "1998-10-22T09:00:00+00:00" }),
        line(1, { id: lineId(11), sub_position: 1, parent_line_id: lineId(1) }),
        line(1, {
          id: lineId(12),
          sub_position: 2,
          parent_line_id: lineId(1),
          lot_code: "L-DEMO-0001",
        }),
      ]),
    );
    const parent = review.lines[0]!;
    expect(parent.lotMissing).toBe(false);
    expect(parent.children?.map((c) => c.lotMissing)).toEqual([true, false]);
    expect(review.summary.stockLinesWithoutLot).toBe(1);
  });

  it("a superseded line is not in the reply and not counted", () => {
    const review = buildReview(
      source([line(1, { superseded_at: "1998-10-22T09:00:00+00:00" }), line(2)]),
    );
    expect(review.lines.map((l) => l.position)).toEqual([2]);
    expect(review.summary.stockLinesWithoutLot).toBe(1);
  });

  it("an empty invoice has none", () => {
    expect(buildReview(source([])).summary.stockLinesWithoutLot).toBe(0);
  });
});

describe("lotMissing on an approved invoice (from the posted lots)", () => {
  const lot = (n: number, lotCode: string | null): LotRow => ({
    invoice_line_id: lineId(n),
    qty_received: 2,
    base_unit: "kg",
    lot_code: lotCode,
  });

  it("reads raw_lot.lot_code; a stock line that posted no lot is not marked", () => {
    const review = buildReview(
      source([line(1), line(2, { lot_code: "L-DEMO-0002" }), line(3)], {
        invoice: invoice("approved"),
        lots: [lot(1, null), lot(2, "L-DEMO-0002")],
      }),
    );
    expect(missing(review)).toEqual({ 1: true, 2: false, 3: false });
    expect(review.summary.stockLinesWithoutLot).toBe(1);
  });

  it("the posted lot decides, not the line's own field", () => {
    const review = buildReview(
      source([line(1, { lot_code: "L-DEMO-0001" })], {
        invoice: invoice("approved"),
        lots: [lot(1, null)],
      }),
    );
    expect(review.lines[0]!.lotMissing).toBe(true);
  });
});

describe("lotMissing on invoices that post nothing", () => {
  it.each(["rejected", "duplicate", "received", "extracting", "extraction_failed"] as const)(
    "an invoice in status %s marks no line and counts none",
    (status) => {
      const review = buildReview(source([line(1), line(2)], { invoice: invoice(status) }));
      expect(missing(review)).toEqual({ 1: false, 2: false });
      expect(review.summary.stockLinesWithoutLot).toBe(0);
    },
  );
});
