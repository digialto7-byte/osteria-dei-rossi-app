import { describe, expect, it } from "vitest";
import { MAX_EXTRACTED_LINES } from "@/server/extraction/constants";
import {
  buildReview,
  MAX_REVIEW_LINES,
  type ReviewInvoiceRow,
  type ReviewLineRow,
  type ApprovalPreview,
  type PayableRow,
  type ReviewSource,
} from "@/server/invoices/review";

const INVOICE_ID = "1b000000-0000-4000-8000-0000000000b1";
const SUPPLIER_ID = "5a000000-0000-4000-8000-000000000001";
const ING_FESA = "1d000000-0000-4000-8000-000000000001";
const ING_OLIO = "1d000000-0000-4000-8000-000000000002";
const ING_SALE = "1d000000-0000-4000-8000-000000000003";
const ITEM_CASSA = "7e000000-0000-4000-8000-000000000001";
const CENTRE = "cc000000-0000-4000-8000-000000000001";

const GOOD = {
  description: 1,
  supplier_code: 1,
  qty: 1,
  unit: 1,
  unit_price: 1,
  line_amount: 1,
  vat_rate: 1,
  lot_code: 1,
  expiry: 1,
};

const invoice = (over: Partial<ReviewInvoiceRow> = {}): ReviewInvoiceRow => ({
  id: INVOICE_ID,
  status: "review",
  source: "upload",
  original_filename: "fattura.pdf",
  file_mime: "application/pdf",
  file_size_bytes: 80,
  supplier_vat: "IT12345678903",
  supplier_name: "Fornitore Demo Srl",
  number_raw: "FT 1/2026",
  invoice_date: "2026-10-01",
  due_date: "2026-11-15",
  net_total: 30,
  vat_total: 3,
  gross_total: 33,
  totals_diff: 0,
  gate_flags: [],
  extraction_error: null,
  attempts: 1,
  extracted_at: "2026-10-22T08:01:00+00:00",
  duplicate_of: null,
  duplicate_warning_of: null,
  created_at: "2026-10-22T08:00:00+00:00",
  supplier_id: SUPPLIER_ID,
  supplier_suggestion_id: null,
  header_corrected_fields: [],
  payment_terms: "30 gg",
  field_confidence: null,
  ...over,
});

const line = (position: number, over: Partial<ReviewLineRow> = {}): ReviewLineRow => ({
  id: `11000000-0000-4000-8000-${String(position).padStart(12, "0")}`,
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
  ingredient_id: ING_FESA,
  supplier_item_id: null,
  mapping_source: "manual",
  suggested_ingredient_id: null,
  field_confidence: GOOD,
  checks: [],
  corrected_fields: [],
  reviewed_at: null,
  ...over,
});

const source = (lines: ReviewLineRow[], over: Partial<ReviewSource> = {}): ReviewSource => ({
  invoice: invoice(),
  suppliers: [{ id: SUPPLIER_ID, name: "Fornitore Demo Srl", vat_number: "IT12345678903" }],
  lines,
  ingredients: [
    { id: ING_FESA, name: "Fesa di manzo", base_unit: "kg" },
    { id: ING_OLIO, name: "Olio extravergine", base_unit: "l" },
    { id: ING_SALE, name: "Sale fino", base_unit: "kg" },
  ],
  items: [{ id: ITEM_CASSA, pack_count: 6, pack_qty: 1, pack_unit: "kg", pack_label: "cassa" }],
  costCentres: [{ id: CENTRE, name: "Pulizie" }],
  ...over,
});

const positions = (lines: { position: number; subPosition: number }[]) =>
  lines.map((l) => `${l.position}.${l.subPosition}`);

describe("buildReview ordering (AT1)", () => {
  it("lists unmapped stock lines first, then lines with highlights, then the rest, each by position", () => {
    const review = buildReview(
      source([
        line(1), // fine
        line(2, { ingredient_id: null, mapping_source: null }), // unmapped
        line(3, { checks: ["amount_mismatch"] }), // highlight
        line(4), // fine
        line(5, { ingredient_id: null, mapping_source: null }), // unmapped
        line(6, { field_confidence: { ...GOOD, qty: 0.5 } }), // highlight
      ]),
    );
    expect(positions(review.lines)).toEqual(["2.0", "5.0", "3.0", "6.0", "1.0", "4.0"]);
  });

  it("does not treat a non-stock line as unmapped", () => {
    const review = buildReview(
      source([
        line(1),
        line(2, {
          ingredient_id: null,
          mapping_source: null,
          is_stock: false,
          cost_centre_id: CENTRE,
        }),
      ]),
    );
    expect(positions(review.lines)).toEqual(["1.0", "2.0"]);
    expect(review.summary.unmapped).toBe(0);
    expect(review.lines[1]!.costCentre).toEqual({ id: CENTRE, name: "Pulizie" });
  });

  it("nests the active parts under a split parent, in the parent's most urgent group", () => {
    const parent = line(2, { split_at: "2026-10-22T09:00:00+00:00", ingredient_id: null });
    const partA = line(2, { id: "a1", sub_position: 1, parent_line_id: parent.id });
    const partB = line(2, {
      id: "a2",
      sub_position: 2,
      parent_line_id: parent.id,
      ingredient_id: null,
      mapping_source: null,
    });
    const review = buildReview(
      source([line(1, { checks: ["amount_mismatch"] }), line(3), parent, partB, partA]),
    );
    expect(positions(review.lines)).toEqual(["2.0", "1.0", "3.0"]);
    const split = review.lines[0]!;
    expect(split.isSplit).toBe(true);
    expect(positions(split.children!)).toEqual(["2.1", "2.2"]);
    expect(review.lines[1]!.children).toBeUndefined();
  });

  it("counts a split's parts, not the parent, and skips superseded parts", () => {
    const parent = line(1, { split_at: "2026-10-22T09:00:00+00:00", line_amount: 10 });
    const old = line(1, {
      id: "old",
      sub_position: 1,
      parent_line_id: parent.id,
      superseded_at: "2026-10-22T09:30:00+00:00",
      line_amount: 99,
    });
    const a = line(1, { id: "a", sub_position: 2, parent_line_id: parent.id, line_amount: 4 });
    const b = line(1, { id: "b", sub_position: 3, parent_line_id: parent.id, line_amount: 6 });
    const review = buildReview(source([parent, old, a, b, line(2, { line_amount: 20 })]));
    expect(review.summary.lines).toBe(3);
    expect(review.gate.linesTotal).toBe(30);
    expect(positions(review.lines[0]!.children!)).toEqual(["1.2", "1.3"]);
  });
});

describe("buildReview line fields", () => {
  it("flags a field at confidence 0.79 until the line has been reviewed", () => {
    const weak = { ...GOOD, qty: 0.79, unit_price: 0.8 };
    const open = buildReview(source([line(1, { field_confidence: weak })])).lines[0]!;
    expect(open.lowConfidenceFields).toEqual(["qty"]);
    expect(open.highlights).toEqual(["low_confidence"]);

    const seen = buildReview(
      source([line(1, { field_confidence: weak, reviewed_at: "2026-10-22T10:00:00+00:00" })]),
    ).lines[0]!;
    expect(seen.lowConfidenceFields).toEqual([]);
    expect(seen.highlights).toEqual([]);
  });

  it("highlights the line checks, also after the line was reviewed", () => {
    const checked = buildReview(
      source([
        line(1, {
          checks: ["amount_mismatch", "vat_rate_unexpected"],
          reviewed_at: "2026-10-22T10:00:00+00:00",
        }),
      ]),
    ).lines[0]!;
    expect(checked.checks).toEqual(["amount_mismatch", "vat_rate_unexpected"]);
    expect(checked.highlights).toEqual(["amount_mismatch", "vat_rate_unexpected"]);
  });

  it("computes the base quantity: 2 conf of a 6 x 1 kg pack is 12 kg", () => {
    const l = buildReview(source([line(1, { qty: 2, unit: "conf", supplier_item_id: ITEM_CASSA })]))
      .lines[0]!;
    expect(l.baseQty).toEqual({ qty: 12, unit: "kg" });
    expect(l.pack).toEqual({ count: 6, size: 1, unit: "kg", label: "cassa" });
  });

  it("converts 500 g to 0.5 kg on a kg ingredient", () => {
    const l = buildReview(source([line(1, { qty: 500, unit: "g" })])).lines[0]!;
    expect(l.baseQty).toEqual({ qty: 0.5, unit: "kg" });
    expect(l.pack).toBeNull();
  });

  it.each([
    ["no unit", { unit: null }],
    ["an incompatible unit", { unit: "l" as const }],
    ["conf without a pack", { unit: "conf" as const }],
    ["no ingredient", { ingredient_id: null, mapping_source: null }],
    ["a non-stock line", { is_stock: false, ingredient_id: null, mapping_source: null }],
  ] satisfies [string, Partial<ReviewLineRow>][])("has no base quantity for %s", (_name, over) => {
    expect(buildReview(source([line(1, over)])).lines[0]!.baseQty).toBeNull();
  });

  it("exposes the suggestion with the ingredient's name, and the mapping source", () => {
    const l = buildReview(
      source([
        line(1, {
          ingredient_id: ING_OLIO,
          mapping_source: "manual",
          suggested_ingredient_id: ING_FESA,
          corrected_fields: ["ingredient"],
        }),
      ]),
    ).lines[0]!;
    expect(l.suggestion).toEqual({ ingredientId: ING_FESA, ingredientName: "Fesa di manzo" });
    expect(l.ingredient).toEqual({ id: ING_OLIO, name: "Olio extravergine", baseUnit: "l" });
    expect(l.mappingSource).toBe("manual");
    expect(l.corrected).toBe(true);
    expect(l.correctedFields).toEqual(["ingredient"]);
  });

  it("copies the printed values and numbers through as numbers", () => {
    const l = buildReview(
      source([
        line(1, {
          supplier_code: "MAN-1",
          lot_code: "L42",
          expiry: "2026-12-01",
          qty: "2.5000" as unknown as number,
        }),
      ]),
    ).lines[0]!;
    expect(l).toMatchObject({
      supplierCode: "MAN-1",
      lotCode: "L42",
      expiry: "2026-12-01",
      qty: 2.5,
      unitRaw: "kg",
      unit: "kg",
      unitPrice: 5,
      lineAmount: 10,
      vatRate: 10,
      isStock: true,
      creditQty: 0,
      parentLineId: null,
      subPosition: 0,
      isSplit: false,
      reviewedAt: null,
    });
  });

  it("drops a line unit the app does not know instead of passing it through", () => {
    const l = buildReview(source([line(1, { unit: "cassa" as never })])).lines[0]!;
    expect(l.unit).toBeNull();
    expect(l.baseQty).toBeNull();
  });
});

describe("buildReview header", () => {
  it("summarises the lines", () => {
    const review = buildReview(
      source([
        line(1, { ingredient_id: null, mapping_source: null }),
        line(2, { checks: ["amount_mismatch"] }),
        line(3, { corrected_fields: ["qty"] }),
        line(4),
      ]),
    );
    expect(review.summary).toEqual({ lines: 4, unmapped: 1, toCheck: 1, corrected: 1 });
  });

  it("builds the gate from the stored flags and the active lines", () => {
    const review = buildReview(
      source([line(1, { line_amount: 10 }), line(2, { line_amount: 20.01 })], {
        invoice: invoice({ gate_flags: ["total_mismatch"], totals_diff: 0.01, vat_total: 3 }),
      }),
    );
    expect(review.gate).toEqual({
      flags: ["total_mismatch"],
      totalsDiff: 0.01,
      linesTotal: 30.01,
      vatTotal: 3,
      grossTotal: 33,
    });
  });

  it("links the supplier, the extracted data and the editable state", () => {
    const review = buildReview(source([]));
    expect(review.supplier).toEqual({
      id: SUPPLIER_ID,
      name: "Fornitore Demo Srl",
      vatNumber: "IT12345678903",
    });
    expect(review.supplierSuggestion).toBeNull();
    expect(review.extractedSupplier).toEqual({
      name: "Fornitore Demo Srl",
      vatNumber: "IT12345678903",
      paymentTerms: "30 gg",
    });
    expect(review.editable).toBe(true);
    expect(review.invoice).toMatchObject({
      id: INVOICE_ID,
      number: "FT 1/2026",
      supplierId: SUPPLIER_ID,
      headerCorrectedFields: [],
      grossTotal: 33,
    });
  });

  it("offers a name-only suggestion when no supplier is linked", () => {
    const review = buildReview(
      source([], {
        invoice: invoice({ supplier_id: null, supplier_suggestion_id: SUPPLIER_ID }),
      }),
    );
    expect(review.supplier).toBeNull();
    expect(review.supplierSuggestion).toEqual({ id: SUPPLIER_ID, name: "Fornitore Demo Srl" });
  });

  it.each(["duplicate", "approved", "rejected", "extraction_failed", "received"] as const)(
    "is read-only in status %s",
    (status) => {
      expect(buildReview(source([], { invoice: invoice({ status }) })).editable).toBe(false);
    },
  );

  it("lists weak header fields until they are corrected", () => {
    const weak = {
      supplier_name: 1,
      supplier_vat: 0.5,
      invoice_number: 0.7,
      invoice_date: 1,
      due_date: 1,
      payment_terms: 1,
      net_total: 1,
      vat_total: 1,
      gross_total: 0.2,
    };
    const open = buildReview(source([], { invoice: invoice({ field_confidence: weak }) }));
    expect(open.invoice.lowConfidenceHeaderFields).toEqual([
      "supplier_vat",
      "number_raw",
      "gross_total",
    ]);
    const fixed = buildReview(
      source([], {
        invoice: invoice({ field_confidence: weak, header_corrected_fields: ["gross_total"] }),
      }),
    );
    expect(fixed.invoice.lowConfidenceHeaderFields).toEqual(["supplier_vat", "number_raw"]);
  });

  it("has no weak header fields for an invoice without stored confidence", () => {
    expect(buildReview(source([])).invoice.lowConfidenceHeaderFields).toEqual([]);
  });
});

describe("the review line limit", () => {
  it("leaves room for every line extraction can produce, plus the parts of several splits", () => {
    // loadInvoiceReview reads at most MAX_REVIEW_LINES rows. Extraction caps an invoice at
    // MAX_EXTRACTED_LINES original lines, so a truncated list would need that cap to be raised
    // without raising this limit. Keep five times the cap: room for the parts of many splits.
    expect(MAX_REVIEW_LINES).toBeGreaterThanOrEqual(MAX_EXTRACTED_LINES * 5);
  });
});

// ---- Approval (M5): the preview from the database, the decision and the posting ----

const lineId = (position: number) =>
  `11000000-0000-4000-8000-${String(position).padStart(12, "0")}`;
const LOCATION_ID = "10000000-0000-4000-8000-000000000001";

type PreviewLines = ApprovalPreview["lines"];

const preview = (over: Partial<ApprovalPreview> = {}): ApprovalPreview => ({
  status: "review",
  blockers: [],
  receiptDate: "2026-09-29",
  payable: {
    grossAmount: 33,
    creditedAmount: 5.5,
    amount: 27.5,
    dueDate: "2026-10-29",
    dueDateSource: "supplier_terms",
  },
  receipts: 2,
  lines: [
    { lineId: lineId(1), receivedQty: 12, baseUnit: "kg", unitPrice: 2.5, creditedAmount: 0 },
    { lineId: lineId(2), receivedQty: 1.5, baseUnit: "kg", unitPrice: 10, creditedAmount: 5.5 },
  ],
  locations: {
    required: false,
    options: [{ id: LOCATION_ID, name: "Cella" }],
    defaultId: LOCATION_ID,
  },
  ...over,
});

const twoLines = () => [
  line(1, { qty: 2, unit: "conf", supplier_item_id: ITEM_CASSA }),
  line(2, { qty: 2, credit_qty: 0.5, unit_price: 10, line_amount: 20 }),
];

describe("buildReview duplicate partner", () => {
  const PARTNER = "1b000000-0000-4000-8000-0000000000b2";
  const row = { id: PARTNER, number_raw: "FT 40", invoice_date: "2026-09-01" };
  const blocked = (code: string, partnerId: string | null) =>
    preview({ blockers: [{ code, lineIds: [], partnerId }] });

  it("is the partner of the preview's duplicate blocker, whichever gate raised it", () => {
    for (const code of ["duplicate_warning", "duplicate_invoice"]) {
      const review = buildReview(
        source([line(1)], { preview: blocked(code, PARTNER), partner: row }),
      );
      expect(review.duplicatePartner).toEqual({ id: PARTNER, number: "FT 40", date: "2026-09-01" });
    }
  });

  it("is null without a duplicate blocker, a partner id, a matching row or a printed number and date", () => {
    expect(buildReview(source([line(1)])).duplicatePartner).toBeNull();
    expect(
      buildReview(source([line(1)], { preview: preview(), partner: row })).duplicatePartner,
    ).toBeNull();
    expect(
      buildReview(source([line(1)], { preview: blocked("duplicate_invoice", null), partner: row }))
        .duplicatePartner,
    ).toBeNull();
    expect(
      buildReview(source([line(1)], { preview: blocked("total_mismatch", PARTNER), partner: row }))
        .duplicatePartner,
    ).toBeNull();
    expect(
      buildReview(
        source([line(1)], {
          preview: blocked("duplicate_warning", PARTNER),
          partner: { ...row, id: "1b000000-0000-4000-8000-0000000000b3" },
        }),
      ).duplicatePartner,
    ).toBeNull();
    for (const over of [{ number_raw: null }, { invoice_date: null }]) {
      expect(
        buildReview(
          source([line(1)], {
            preview: blocked("duplicate_warning", PARTNER),
            partner: { ...row, ...over },
          }),
        ).duplicatePartner,
      ).toBeNull();
    }
  });

  it("does not leak the partner id into the approval blockers", () => {
    const { approval } = buildReview(
      source([line(1)], { preview: blocked("duplicate_warning", PARTNER), partner: row }),
    );
    expect(approval?.blockers).toEqual([{ code: "duplicate_warning", lineIds: [] }]);
  });
});

describe("buildReview approval (review status)", () => {
  it("has no approval without a preview, and no decision or posting", () => {
    const review = buildReview(source([line(1)]));
    expect(review.approval).toBeNull();
    expect(review.decision).toBeNull();
    expect(review.posting).toBeNull();
    expect(review.lines[0]!.toReceive).toBeNull();
    expect(review.lines[0]!.received).toBeNull();
    expect(review.lines[0]!.creditAmount).toBeNull();
  });

  it("blocks approval while the preview lists blockers, in camelCase with line ids", () => {
    const blockers = [
      { code: "lines_unmapped", lineIds: [lineId(1)] },
      { code: "due_date_required", lineIds: [] },
    ];
    const { approval } = buildReview(source(twoLines(), { preview: preview({ blockers }) }));
    expect(approval?.canApprove).toBe(false);
    expect(approval?.blockers).toEqual(blockers);
  });

  it("allows approval with an empty blocker list and carries the preview's figures", () => {
    const { approval } = buildReview(source(twoLines(), { preview: preview() }));
    expect(approval).toEqual({
      canApprove: true,
      blockers: [],
      receiptDate: "2026-09-29",
      payable: {
        grossAmount: 33,
        creditedAmount: 5.5,
        amount: 27.5,
        dueDate: "2026-10-29",
        dueDateSource: "supplier_terms",
      },
      receipts: 2,
      locations: {
        required: false,
        options: [{ id: LOCATION_ID, name: "Cella" }],
        defaultId: LOCATION_ID,
      },
    });
  });

  it("takes creditAmount from the preview, VAT included (5,50), not from qty x price", () => {
    const review = buildReview(source(twoLines(), { preview: preview() }));
    expect(review.lines[1]!.creditAmount).toBe(5.5);
    expect(review.lines[0]!.creditAmount).toBe(0);
  });

  it("has a null creditAmount when the preview has none (credit without VAT rate)", () => {
    const lines: PreviewLines = [
      { lineId: lineId(1), receivedQty: 1, baseUnit: "kg", unitPrice: 5, creditedAmount: null },
    ];
    const review = buildReview(source([line(1)], { preview: preview({ lines }) }));
    expect(review.lines[0]!.creditAmount).toBeNull();
  });

  it("shows what each line will post: 12 kg on the conf line", () => {
    const review = buildReview(source(twoLines(), { preview: preview() }));
    expect(review.lines[0]!.toReceive).toEqual({ qty: 12, unit: "kg", unitPrice: 2.5 });
    expect(review.lines[1]!.toReceive).toEqual({ qty: 1.5, unit: "kg", unitPrice: 10 });
    expect(review.lines[0]!.received).toBeNull();
  });

  it("has no toReceive for a line that posts nothing (non-stock, unconvertible)", () => {
    const lines: PreviewLines = [
      { lineId: lineId(1), receivedQty: null, baseUnit: null, unitPrice: null, creditedAmount: 0 },
      { lineId: lineId(2), receivedQty: null, baseUnit: "kg", unitPrice: null, creditedAmount: 0 },
    ];
    const review = buildReview(source([line(1), line(2)], { preview: preview({ lines }) }));
    expect(review.lines.map((l) => l.toReceive)).toEqual([null, null]);
  });

  it("keeps a fully credited line's zero receipt, with no price", () => {
    const lines: PreviewLines = [
      { lineId: lineId(1), receivedQty: 0, baseUnit: "kg", unitPrice: null, creditedAmount: 22 },
    ];
    const review = buildReview(source([line(1)], { preview: preview({ lines }) }));
    expect(review.lines[0]!.toReceive).toEqual({ qty: 0, unit: "kg", unitPrice: null });
  });

  it("reaches the parts of a split line through the preview", () => {
    const split = [
      line(1, { split_at: "2026-10-22T09:00:00+00:00" }),
      line(1, { id: lineId(11), parent_line_id: lineId(1), sub_position: 1 }),
    ];
    const lines: PreviewLines = [
      { lineId: lineId(11), receivedQty: 2, baseUnit: "kg", unitPrice: 5, creditedAmount: 0 },
    ];
    const review = buildReview(source(split, { preview: preview({ lines }) }));
    expect(review.lines[0]!.children![0]!.toReceive).toEqual({ qty: 2, unit: "kg", unitPrice: 5 });
  });

  it("gives no approval to an invoice that is not in review, even with a preview", () => {
    const duplicate = invoice({ status: "duplicate" });
    const review = buildReview(source(twoLines(), { invoice: duplicate, preview: preview() }));
    expect(review.approval).toBeNull();
  });
});

const decision = (over = {}) => ({
  action: "invoice.approved" as const,
  created_at: "2026-10-29T09:12:00+00:00",
  actor_name: "Titolare Demo",
  reason: null,
  location_id: LOCATION_ID,
  ...over,
});
const payableRow: PayableRow = {
  gross_amount: 33,
  credited_amount: 5.5,
  amount: 27.5,
  due_date: "2026-10-29",
  due_date_source: "supplier_terms",
  status: "open",
};

describe("buildReview decision and posting", () => {
  const approved = (over: Partial<ReviewSource> = {}) =>
    buildReview(
      source(twoLines(), {
        invoice: invoice({ status: "approved" }),
        preview: preview({ status: "approved" }),
        decision: decision(),
        payable: payableRow,
        locationName: "Cella",
        lots: [
          { invoice_line_id: lineId(1), qty_received: "12.0000", base_unit: "kg" },
          { invoice_line_id: lineId(2), qty_received: 1.5, base_unit: "kg" },
        ],
        ...over,
      }),
    );

  it("describes an approval: who, when, the posted payable and the location", () => {
    const review = approved();
    expect(review.approval).toBeNull();
    expect(review.decision).toEqual({
      action: "approved",
      at: "2026-10-29T09:12:00+00:00",
      byName: "Titolare Demo",
      reason: null,
    });
    expect(review.posting).toEqual({
      payable: {
        grossAmount: 33,
        creditedAmount: 5.5,
        amount: 27.5,
        dueDate: "2026-10-29",
        dueDateSource: "supplier_terms",
        status: "open",
      },
      locationName: "Cella",
    });
  });

  it("shows what each line posted, from the lots, as numbers", () => {
    const review = approved();
    expect(review.lines[0]!.received).toEqual({ qty: 12, unit: "kg" });
    expect(review.lines[1]!.received).toEqual({ qty: 1.5, unit: "kg" });
    expect(review.lines[0]!.toReceive).toBeNull();
  });

  it("leaves received empty for a line without a lot (non-stock, fully credited)", () => {
    const review = approved({
      lots: [{ invoice_line_id: lineId(1), qty_received: 12, base_unit: "kg" }],
    });
    expect(review.lines[1]!.received).toBeNull();
  });

  it("tolerates a missing actor name and a missing payable", () => {
    const review = approved({ decision: decision({ actor_name: null }), payable: null });
    expect(review.decision?.byName).toBeNull();
    expect(review.posting).toBeNull();
  });

  it("passes a rejection through with its reason, and has no posting", () => {
    const review = buildReview(
      source(twoLines(), {
        invoice: invoice({ status: "rejected" }),
        decision: decision({ action: "invoice.rejected", reason: "Merce non ordinata" }),
      }),
    );
    expect(review.decision).toEqual({
      action: "rejected",
      at: "2026-10-29T09:12:00+00:00",
      byName: "Titolare Demo",
      reason: "Merce non ordinata",
    });
    expect(review.posting).toBeNull();
    expect(review.approval).toBeNull();
    expect(review.lines.every((l) => l.received === null)).toBe(true);
  });

  it("has a decision only for approved or rejected invoices", () => {
    const review = buildReview(source(twoLines(), { decision: decision() }));
    expect(review.decision).toBeNull();
  });

  it("does not show a rejected invoice's reason as an approval's", () => {
    const review = approved({ decision: decision({ reason: "ignored" }) });
    expect(review.decision?.reason).toBeNull();
  });
});
