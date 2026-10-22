import { beforeEach, describe, expect, it, vi } from "vitest";
import { routeContext, type FakeResult, type FakeSupabase } from "../../../helpers/fake-supabase";
import {
  INVOICE_ID,
  INVOICE_ROW,
  PARTNER_ID,
  SUPPLIER_ID,
  dbError,
  ok,
  procedureCalls,
  reviewClient,
} from "../../../helpers/review-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const supplierRoute = await import("@/app/api/invoices/[id]/supplier/route");
const invoiceRoute = await import("@/app/api/invoices/[id]/route");
const notDuplicate = await import("@/app/api/invoices/[id]/not-duplicate/route");
const retryRoute = await import("@/app/api/invoices/[id]/retry/route");

const BASE = `http://localhost:3000/api/invoices/${INVOICE_ID}`;
const context = routeContext({ id: INVOICE_ID });
// Valid Italian VAT number from the M1 fixtures (checksum correct).
const VAT = "IT12345678903";

type Handler = (
  request: Request,
  context?: { params: Promise<Record<string, string>> },
) => Promise<Response>;
const call = (
  handler: Handler,
  method: string,
  path: string,
  body: unknown = {},
  init: RequestInit = {},
) =>
  handler(
    new Request(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
      ...init,
    }),
    context,
  );

const setSupplier = (body: unknown, init?: RequestInit) =>
  call(supplierRoute.POST as Handler, "POST", "/supplier", body, init);
const patchHeader = (body: unknown, init?: RequestInit) =>
  call(invoiceRoute.PATCH as Handler, "PATCH", "", body, init);
const clear = (body: unknown = { partnerId: PARTNER_ID }, init?: RequestInit) =>
  call(notDuplicate.POST as Handler, "POST", "/not-duplicate", body, init);
const retry = (body: unknown = {}, init?: RequestInit) =>
  call(retryRoute.POST as Handler, "POST", "/retry", body, init);

function as(
  role: string,
  rpc: Record<string, FakeResult> = {},
  tables: Record<string, FakeResult[]> = {},
) {
  client = reviewClient(role, {
    rpc: Object.fromEntries(Object.entries(rpc).map(([name, result]) => [name, [result]])),
    tables,
  });
}

beforeEach(() => as("owner"));

describe("POST /api/invoices/:id/supplier", () => {
  it("links an existing supplier", async () => {
    const response = await setSupplier({ supplierId: SUPPLIER_ID });
    expect(response.status).toBe(200);
    expect(procedureCalls(client)).toHaveLength(1);
    expect(client.rpc).toHaveBeenCalledWith("review_set_supplier", {
      p_invoice: INVOICE_ID,
      p_supplier: SUPPLIER_ID,
      p_new: null,
    });
    expect((await response.json()).review.supplier.id).toBe(SUPPLIER_ID);
  });

  it("creates a supplier from the extracted data, VAT normalised", async () => {
    const response = await setSupplier({
      create: { name: "  Fornitore Demo Srl ", vatNumber: "12345678903", paymentTermsDays: 30 },
    });
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith("review_set_supplier", {
      p_invoice: INVOICE_ID,
      p_supplier: null,
      p_new: { name: "Fornitore Demo Srl", vat_number: VAT, payment_terms_days: 30 },
    });
  });

  it("creates a supplier without a VAT number or terms", async () => {
    await setSupplier({ create: { name: "Fornitore Demo Srl" } });
    expect(client.rpc).toHaveBeenCalledWith("review_set_supplier", {
      p_invoice: INVOICE_ID,
      p_supplier: null,
      p_new: { name: "Fornitore Demo Srl" },
    });
    await setSupplier({
      create: { name: "Fornitore Demo Srl", vatNumber: null, paymentTermsDays: null },
    });
    expect(procedureCalls(client).at(-1)).toEqual([
      "review_set_supplier",
      {
        p_invoice: INVOICE_ID,
        p_supplier: null,
        p_new: { name: "Fornitore Demo Srl", vat_number: null, payment_terms_days: null },
      },
    ]);
  });

  it("answers 422 invalid_vat_number for a bad checksum, before any call", async () => {
    const response = await setSupplier({
      create: { name: "Fornitore Demo Srl", vatNumber: "IT12345678900" },
    });
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("invalid_vat_number");
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("answers 409 duplicate_vat_number when the VAT exists (23505)", async () => {
    as("owner", {
      review_set_supplier: dbError(
        "23505",
        'duplicate key value violates unique constraint "supplier_tenant_vat_uq"',
      ),
    });
    const response = await setSupplier({ create: { name: "Altro", vatNumber: VAT } });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("duplicate_vat_number");
  });

  it.each([
    ["both supplierId and create", { supplierId: SUPPLIER_ID, create: { name: "X" } }],
    ["neither", {}],
    ["a bad supplier id", { supplierId: "x" }],
    ["an empty name", { create: { name: "  " } }],
    ["an unknown key in create", { create: { name: "X", extra: 1 } }],
    ["terms of 366 days", { create: { name: "X", paymentTermsDays: 366 } }],
    ["fractional terms", { create: { name: "X", paymentTermsDays: 1.5 } }],
    ["an unknown key", { supplierId: SUPPLIER_ID, x: 1 }],
  ])("answers 400 for %s", async (_name, body) => {
    const response = await setSupplier(body);
    expect(response.status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("maps a missing or foreign supplier to 404", async () => {
    as("owner", { review_set_supplier: dbError("P0002", "not_found") });
    expect((await setSupplier({ supplierId: SUPPLIER_ID })).status).toBe(404);
  });

  it("maps invoice_not_in_review to 409", async () => {
    as("owner", { review_set_supplier: dbError("P0001", "invoice_not_in_review") });
    expect((await setSupplier({ supplierId: SUPPLIER_ID })).status).toBe(409);
  });
});

describe("PATCH /api/invoices/:id", () => {
  it("passes the corrections as snake_case and returns the review", async () => {
    const response = await patchHeader({
      numberRaw: " FT 2/2026 ",
      invoiceDate: "2026-10-02",
      dueDate: null,
      netTotal: 100,
      vatTotal: 22,
      grossTotal: 122,
    });
    expect(response.status).toBe(200);
    expect(procedureCalls(client)).toHaveLength(1);
    expect(client.rpc).toHaveBeenCalledWith("review_update_header", {
      p_invoice: INVOICE_ID,
      p_patch: {
        number_raw: "FT 2/2026",
        invoice_date: "2026-10-02",
        due_date: null,
        net_total: 100,
        vat_total: 22,
        gross_total: 122,
      },
    });
    const text = JSON.stringify(await response.json());
    expect(text).not.toMatch(/file_?path|extraction_?json|claim_?token|last_?price/i);
  });

  it.each([
    ["a negative total", { grossTotal: -1 }],
    ["five decimals", { netTotal: 1.00001 }],
    ["a total above the cap", { grossTotal: 10_000_001 }],
    ["an empty body", {}],
    ["an unknown key", { status: "approved" }],
    ["a bad date", { invoiceDate: "02/10/2026" }],
    ["a 65-char number", { numberRaw: "x".repeat(65) }],
  ])("answers 400 for %s", async (_name, body) => {
    const response = await patchHeader(body);
    expect(response.status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("maps invoice_not_in_review to 409 and a malformed date from the database to 422", async () => {
    as("owner", { review_update_header: dbError("P0001", "invoice_not_in_review") });
    expect((await patchHeader({ grossTotal: 1 })).status).toBe(409);
    as("owner", { review_update_header: dbError("22008", "date/time field value out of range") });
    expect((await patchHeader({ invoiceDate: "2026-02-28" })).status).toBe(422);
  });

  it.each(["chef", "waiter"])("answers 403 for a %s", async (role) => {
    as(role);
    expect((await patchHeader({ grossTotal: 1 })).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("requires JSON", async () => {
    const response = await patchHeader("x", { headers: { "content-type": "text/plain" } });
    expect(response.status).toBe(415);
  });

  it("still has no DELETE or PUT", () => {
    for (const method of ["DELETE", "PUT"]) expect(invoiceRoute).not.toHaveProperty(method);
  });
});

describe("POST /api/invoices/:id/not-duplicate", () => {
  it("declares the named pair and returns the review", async () => {
    const response = await clear();
    expect(response.status).toBe(200);
    expect(procedureCalls(client)).toEqual([
      ["review_clear_duplicate", { p_invoice: INVOICE_ID, p_partner: PARTNER_ID }],
    ]);
    expect(await response.json()).toHaveProperty("review");
  });

  it("answers 200 with the current review when the pair was already declared (a no-op)", async () => {
    // The database returns normally and writes nothing; the route cannot tell, and need not.
    as("owner", { review_clear_duplicate: ok(null) });
    const response = await clear();
    expect(response.status).toBe(200);
    expect((await response.json()).review).toMatchObject({ invoice: { id: INVOICE_ID } });
    expect(procedureCalls(client)).toHaveLength(1);
  });

  it("answers 409 not_flagged, in Italian, for a partner that is no longer a look-alike", async () => {
    as("owner", { review_clear_duplicate: dbError("P0001", "not_flagged") });
    const response = await clear();
    expect(response.status).toBe(409);
    const { error } = await response.json();
    expect(error.code).toBe("not_flagged");
    expect(error.message).toMatch(/doppione/);
    expect(error.message).not.toMatch(/P0001|not_flagged/);
  });

  it("answers 404 for another tenant's invoice", async () => {
    as("owner", { review_clear_duplicate: dbError("P0002", "not_found") });
    expect((await clear()).status).toBe(404);
  });

  it.each([
    ["no body fields", {}],
    ["a partnerId that is not a uuid", { partnerId: "x" }],
    ["a null partnerId", { partnerId: null }],
    ["an extra key", { partnerId: PARTNER_ID, x: 1 }],
    ["the old empty-looking body with another key", { x: 1 }],
  ])("answers 400 for %s, before any call", async (_name, body) => {
    const response = await clear(body);
    expect(response.status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("answers 400 for a body that is not JSON", async () => {
    expect((await clear("{not json")).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe("POST /api/invoices/:id/retry", () => {
  it("puts the invoice back in the queue and answers 202 with the invoice", async () => {
    as("owner", {}, { invoice: [ok({ ...INVOICE_ROW, status: "received", attempts: 0 })] });
    const response = await retry();
    expect(response.status).toBe(202);
    expect(client.rpc).toHaveBeenCalledWith("retry_extraction", { p_invoice: INVOICE_ID });
    const { invoice } = await response.json();
    expect(invoice).toMatchObject({ id: INVOICE_ID, status: "received", attempts: 0 });
    expect(JSON.stringify(invoice)).not.toMatch(/file_?path|extraction_?json|claim_?token/i);
  });

  it("answers 409 not_failed", async () => {
    as("owner", { retry_extraction: dbError("P0001", "not_failed") });
    const response = await retry();
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("not_failed");
  });

  it("answers 404 for another tenant's invoice", async () => {
    as("owner", { retry_extraction: dbError("P0002", "not_found") });
    expect((await retry()).status).toBe(404);
  });
});

describe.each([
  ["supplier", () => setSupplier({ supplierId: SUPPLIER_ID })],
  ["not-duplicate", () => clear()],
  ["retry", () => retry()],
])("access to /%s", (_name, run) => {
  it.each(["chef", "waiter"])("answers 403 for a %s before any call", async (role) => {
    as(role);
    expect((await run()).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("answers 401 without a session", async () => {
    as("none");
    expect((await run()).status).toBe(401);
  });
});

describe.each([
  ["supplier", (init: RequestInit) => setSupplier({ supplierId: SUPPLIER_ID }, init)],
  ["not-duplicate", (init: RequestInit) => clear({ partnerId: PARTNER_ID }, init)],
  ["retry", (init: RequestInit) => retry({}, init)],
])("content type of /%s", (_name, run) => {
  it("requires application/json", async () => {
    const response = await run({ headers: { "content-type": "text/plain" } });
    expect(response.status).toBe(415);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
