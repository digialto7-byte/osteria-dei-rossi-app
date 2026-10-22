import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  routeContext,
  type FakeResult,
  type FakeSupabase,
} from "../../../helpers/fake-supabase";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const route = await import("@/app/api/invoices/[id]/review/route");

const ID = "1b000000-0000-4000-8000-0000000000b1";
const SUPPLIER = "5a000000-0000-4000-8000-000000000001";
const INGREDIENT = "1d000000-0000-4000-8000-000000000001";
const URL_ = `http://localhost:3000/api/invoices/${ID}/review`;
const ok = (data: unknown): FakeResult => ({ data, error: null });

const INVOICE_ROW = {
  id: ID,
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
  supplier_id: SUPPLIER,
  supplier_suggestion_id: null,
  header_corrected_fields: [],
  payment_terms: null,
  field_confidence: null,
  // Never selected by the route; present here to prove the response cannot leak it.
  extraction_json: { secret: "payload" },
  claim_token: "0b000000-0000-4000-8000-000000000001",
  file_path: "tenant/2026/secret.pdf",
};
const LINE_ROW = {
  id: "11000000-0000-4000-8000-000000000001",
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
  ingredient_id: INGREDIENT,
  supplier_item_id: null,
  mapping_source: "manual",
  suggested_ingredient_id: null,
  field_confidence: {},
  checks: [],
  corrected_fields: [],
  reviewed_at: null,
  last_price: 4.2,
};

function as(role: string, overrides: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({
    claims: claimsFor(role),
    results: {
      invoice: [ok(INVOICE_ROW)],
      invoice_line: [ok([LINE_ROW])],
      supplier: [ok([{ id: SUPPLIER, name: "Fornitore Demo Srl", vat_number: "IT12345678903" }])],
      ingredient: [ok([{ id: INGREDIENT, name: "Fesa di manzo", base_unit: "kg" }])],
      supplier_item: [ok([])],
      cost_centre: [ok([])],
      ...overrides,
    },
  });
}

beforeEach(() => as("owner"));

describe("GET /api/invoices/:id/review", () => {
  it("returns the review payload with the documented keys", async () => {
    const response = await route.GET(new Request(URL_), routeContext({ id: ID }));
    expect(response.status).toBe(200);
    const { review } = await response.json();
    expect(Object.keys(review).sort()).toEqual(
      [
        "editable",
        "extractedSupplier",
        "gate",
        "invoice",
        "lines",
        "summary",
        "supplier",
        "supplierSuggestion",
      ].sort(),
    );
    expect(review.lines).toHaveLength(1);
    expect(review.lines[0]).toMatchObject({
      rawDescription: "Fesa di manzo",
      ingredient: { name: "Fesa di manzo", baseUnit: "kg" },
      baseQty: { qty: 2, unit: "kg" },
    });
    expect(review.editable).toBe(true);
    expect(client.query.eq).toHaveBeenCalledWith("id", ID);
    expect(client.query.eq).toHaveBeenCalledWith("invoice_id", ID);
  });

  it("never returns file_path, extraction_json, claim_token or last_price", async () => {
    const text = await (await route.GET(new Request(URL_), routeContext({ id: ID }))).text();
    expect(text).not.toMatch(/file_?path|extraction_?json|claim_?token|last_?price/i);
    expect(text).not.toMatch(/secret\.pdf|payload/);
    const selected = client.query.select.mock.calls.map((call) => String(call[0]));
    for (const columns of selected) {
      expect(columns).not.toMatch(/file_path|extraction_json|claim_token|last_price/);
    }
  });

  it("reads active lines in position order and skips lookups it does not need", async () => {
    as("owner", { invoice_line: [ok([])] });
    await route.GET(new Request(URL_), routeContext({ id: ID }));
    expect(client.query.is).toHaveBeenCalledWith("superseded_at", null);
    expect(client.query.order).toHaveBeenCalledWith("position");
    expect(client.query.order).toHaveBeenCalledWith("sub_position");
    const tables = client.from.mock.calls.map((call) => call[0]);
    expect(tables).not.toContain("ingredient");
    expect(tables).not.toContain("cost_centre");
  });

  it("works for an admin and for an invoice in any status", async () => {
    as("admin", { invoice: [ok({ ...INVOICE_ROW, status: "approved" })] });
    const response = await route.GET(new Request(URL_), routeContext({ id: ID }));
    expect(response.status).toBe(200);
    expect((await response.json()).review.editable).toBe(false);
  });

  it.each(["chef", "waiter"])("answers 403 for a %s before any query", async (role) => {
    as(role);
    const response = await route.GET(new Request(URL_), routeContext({ id: ID }));
    expect(response.status).toBe(403);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("answers 401 without a session", async () => {
    client = fakeSupabase({ claims: null });
    expect((await route.GET(new Request(URL_), routeContext({ id: ID }))).status).toBe(401);
  });

  it("answers 404 for an unknown or other-tenant id (RLS returns no row)", async () => {
    as("owner", { invoice: [ok(null)] });
    const response = await route.GET(new Request(URL_), routeContext({ id: ID }));
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("not_found");
  });

  it("answers 404 for a malformed id without querying", async () => {
    const response = await route.GET(new Request(URL_), routeContext({ id: "x" }));
    expect(response.status).toBe(404);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("answers 500 without details on an unexpected database error", async () => {
    as("owner", { invoice_line: [{ data: null, error: { code: "XX000", message: "boom" } }] });
    const response = await route.GET(new Request(URL_), routeContext({ id: ID }));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("boom");
  });
});
