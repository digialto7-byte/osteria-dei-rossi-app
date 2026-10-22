import { claimsFor, fakeSupabase, type FakeResult } from "./fake-supabase";

export const INVOICE_ID = "1b000000-0000-4000-8000-0000000000b1";
export const LINE_ID = "11000000-0000-4000-8000-000000000001";
export const SUPPLIER_ID = "5a000000-0000-4000-8000-000000000001";
export const INGREDIENT_ID = "1d000000-0000-4000-8000-000000000001";
export const PARTNER_ID = "1b000000-0000-4000-8000-0000000000b2";
export const CENTRE_ID = "cc000000-0000-4000-8000-000000000001";

export const ok = (data: unknown): FakeResult => ({ data, error: null });
export const dbError = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

/** An invoice row as the review query returns it; the private columns are there on purpose. */
export const INVOICE_ROW = {
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
  due_date: null,
  net_total: 10,
  vat_total: 1,
  gross_total: 11,
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
  payment_terms: null,
  field_confidence: null,
  // Never selected by the routes; present to prove a response cannot leak them.
  extraction_json: { secret: "payload" },
  claim_token: "0b000000-0000-4000-8000-000000000001",
  file_path: "tenant/2026/secret.pdf",
};

export const LINE_ROW = {
  id: LINE_ID,
  position: 1,
  sub_position: 0,
  parent_line_id: null,
  split_at: null,
  superseded_at: null,
  raw_description: "Fesa di manzo",
  supplier_code: "MAN-1",
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
  ingredient_id: INGREDIENT_ID,
  supplier_item_id: null,
  mapping_source: "manual",
  suggested_ingredient_id: null,
  field_confidence: {},
  checks: [],
  corrected_fields: [],
  reviewed_at: null,
  last_price: 4.2,
};

/** A client that signs in as `role` and serves one reviewable invoice with one line. */
export function reviewClient(
  role: string,
  options: {
    tables?: Record<string, FakeResult[]>;
    rpc?: Record<string, FakeResult[]>;
  } = {},
) {
  return fakeSupabase({
    claims: role === "none" ? null : claimsFor(role),
    results: {
      invoice: [ok(INVOICE_ROW)],
      invoice_line: [ok([LINE_ROW])],
      supplier: [
        ok([{ id: SUPPLIER_ID, name: "Fornitore Demo Srl", vat_number: "IT12345678903" }]),
      ],
      ingredient: [ok([{ id: INGREDIENT_ID, name: "Fesa di manzo", base_unit: "kg" }])],
      supplier_item: [ok([])],
      cost_centre: [ok([])],
      ...options.tables,
    },
    // Every review reload reads the approval preview; tests of other procedures get the default.
    rpc: { ...previewRpc(), ...options.rpc },
  });
}

/** The calls to review procedures: the approval preview a reload makes is left out. */
export const procedureCalls = (client: { rpc: { mock: { calls: unknown[][] } } }) =>
  client.rpc.mock.calls.filter(([name]) => name !== "invoice_approval_preview");

export const LOCATION_ID = "10000000-0000-4000-8000-000000000001";
export const ACTOR_ID = "a0000000-0000-4000-8000-00000000000a";

/** What `invoice_approval_preview` returns for INVOICE_ROW and LINE_ROW. */
export const PREVIEW = {
  status: "review",
  blockers: [],
  receiptDate: "2026-10-01",
  payable: {
    grossAmount: 11,
    creditedAmount: 0,
    amount: 11,
    dueDate: "2026-10-31",
    dueDateSource: "supplier_terms",
  },
  receipts: 1,
  lines: [{ lineId: LINE_ID, receivedQty: 2, baseUnit: "kg", unitPrice: 5, creditedAmount: 0 }],
  locations: {
    required: false,
    options: [{ id: LOCATION_ID, name: "Cella" }],
    defaultId: LOCATION_ID,
  },
};

/** The tables an approved invoice is read from, besides the invoice and its lines. */
export const APPROVED_TABLES: Record<string, FakeResult[]> = {
  invoice: [ok({ ...INVOICE_ROW, status: "approved" })],
  audit_event: [
    ok({
      action: "invoice.approved",
      created_at: "2026-10-29T09:12:00+00:00",
      created_by: ACTOR_ID,
      reason: null,
      after: { location_id: LOCATION_ID, amount: 11, unit_cost: 5, last_price: 5 },
    }),
  ],
  app_user: [ok({ display_name: "Titolare Demo" })],
  payable: [
    ok({
      gross_amount: "11.00",
      credited_amount: "0.00",
      amount: "11.00",
      due_date: "2026-10-31",
      due_date_source: "supplier_terms",
      status: "open",
    }),
  ],
  location: [ok({ name: "Cella" })],
  raw_lot: [ok([{ invoice_line_id: LINE_ID, qty_received: "2.0000", base_unit: "kg" }])],
};

/** Preview results as the fake client serves them. */
export const previewRpc = (data: unknown = PREVIEW): Record<string, FakeResult[]> => ({
  invoice_approval_preview: [ok(data)],
});
