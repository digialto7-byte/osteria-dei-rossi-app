import { beforeEach, describe, expect, it, vi } from "vitest";
import { routeContext, type FakeResult, type FakeSupabase } from "../../../helpers/fake-supabase";
import {
  APPROVED_TABLES,
  INVOICE_ID,
  INVOICE_ROW,
  LOCATION_ID,
  dbError,
  ok,
  procedureCalls,
  reviewClient,
} from "../../../helpers/review-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({
  reportError: (...args: unknown[]) => reportError(...args),
}));

const approveRoute = await import("@/app/api/invoices/[id]/approve/route");
const rejectRoute = await import("@/app/api/invoices/[id]/reject/route");

const BASE = `http://localhost:3000/api/invoices/${INVOICE_ID}`;
const context = routeContext({ id: INVOICE_ID });

type Handler = (
  request: Request,
  context?: { params: Promise<Record<string, string>> },
) => Promise<Response>;
const post = (handler: Handler, path: string, body: unknown, init: RequestInit = {}) =>
  handler(
    new Request(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
      ...init,
    }),
    context,
  );
const approve = (body: unknown = {}, init?: RequestInit) =>
  post(approveRoute.POST as Handler, "/approve", body, init);
const reject = (body: unknown = {}, init?: RequestInit) =>
  post(rejectRoute.POST as Handler, "/reject", body, init);

const APPROVED_RESULT = ok({ payableId: "pa000000-0000-4000-8000-000000000001", amount: 11 });

/** `rpc` maps a procedure name to its result; `tables` overrides what the reload reads. */
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

beforeEach(() => {
  reportError.mockClear();
  as("owner", { approve_invoice: APPROVED_RESULT, reject_invoice: ok(null) });
});

describe("POST /api/invoices/:id/approve", () => {
  it("calls approve_invoice once without a location and returns the refreshed review", async () => {
    as("owner", { approve_invoice: APPROVED_RESULT }, APPROVED_TABLES);
    const response = await approve();
    expect(response.status).toBe(200);
    expect(procedureCalls(client)).toEqual([
      ["approve_invoice", { p_invoice: INVOICE_ID, p_location: null }],
    ]);
    const { review } = await response.json();
    expect(review.invoice.status).toBe("approved");
    expect(review.decision).toMatchObject({ action: "approved", byName: "Titolare Demo" });
    expect(review.posting.payable.amount).toBe(11);
    expect(review.approval).toBeNull();
  });

  it("passes the chosen location", async () => {
    await approve({ locationId: LOCATION_ID });
    expect(procedureCalls(client)).toEqual([
      ["approve_invoice", { p_invoice: INVOICE_ID, p_location: LOCATION_ID }],
    ]);
  });

  it("works for an admin", async () => {
    as("admin", { approve_invoice: APPROVED_RESULT });
    expect((await approve()).status).toBe(200);
  });

  it("never leaks a cost column or a private column in the response", async () => {
    as("owner", { approve_invoice: APPROVED_RESULT }, APPROVED_TABLES);
    const text = await (await approve()).text();
    expect(text).not.toMatch(/file_?path|extraction_?json|claim_?token|last_?price|unit_?cost/i);
  });

  it.each([
    // AT1, AT2, AT5 and the other gates that refuse the invoice as it is.
    ["total_mismatch", 409],
    ["duplicate_invoice", 409],
    ["invoice_already_approved", 409],
    ["invoice_rejected", 409],
    ["duplicate_warning", 409],
    ["invoice_not_in_review", 409],
    ["supplier_required", 422],
    ["invoice_date_required", 422],
    ["invoice_date_in_future", 422],
    ["due_date_required", 422],
    ["lines_unmapped", 422],
    ["line_base_qty_unavailable", 422],
    ["credit_vat_rate_missing", 422],
    ["payable_negative", 422],
    ["no_location", 422],
    ["location_required", 422],
    ["location_not_found", 422],
  ])(
    "maps the database code %s to %i with the same code and an Italian message",
    async (code, status) => {
      as("owner", { approve_invoice: dbError("P0001", code) });
      const response = await approve();
      expect(response.status).toBe(status);
      const { error } = await response.json();
      expect(error.code).toBe(code);
      expect(error.message).not.toContain(code);
      // The refused call changes nothing and reloads nothing.
      expect(procedureCalls(client)).toHaveLength(1);
      expect(client.from).not.toHaveBeenCalled();
    },
  );

  it("answers 409 conflict for a trigger or unique-key backstop, without database text", async () => {
    as("owner", { approve_invoice: dbError("P0001", "invoice_line_frozen") });
    const frozen = await approve();
    expect(frozen.status).toBe(409);
    expect((await frozen.json()).error.code).toBe("conflict");
    as("owner", {
      approve_invoice: dbError("23505", 'duplicate key value violates "payable_invoice_uq"'),
    });
    const unique = await approve();
    expect(unique.status).toBe(409);
    expect(JSON.stringify(await unique.json())).not.toContain("payable_invoice_uq");
  });

  it("answers 404 for an unknown or other tenant's invoice (P0002)", async () => {
    as("owner", { approve_invoice: dbError("P0002", "not_found") });
    const response = await approve();
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("not_found");
  });

  it("answers 403 when the database refuses the role (42501)", async () => {
    as("owner", { approve_invoice: dbError("42501", "insufficient_privilege") });
    expect((await approve()).status).toBe(403);
  });

  it("answers 500 without database text for an unexpected error, and reports it", async () => {
    as("owner", { approve_invoice: dbError("XX000", 'relation "payable" exploded') });
    const response = await approve();
    expect(response.status).toBe(500);
    const text = JSON.stringify(await response.json());
    expect(text).not.toMatch(/payable|exploded|XX000/);
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("answers 500 for an unknown P0001 message without echoing it", async () => {
    as("owner", { approve_invoice: dbError("P0001", "secret internal detail") });
    const response = await approve();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });

  it.each(["chef", "waiter"])("answers 403 for a %s before any call (AT7)", async (role) => {
    as(role);
    const response = await approve();
    expect(response.status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("answers 401 without a session", async () => {
    as("none");
    expect((await approve()).status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("requires application/json", async () => {
    const response = await approve("x", { headers: { "content-type": "text/plain" } });
    expect(response.status).toBe(415);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown key", { force: true }],
    ["a bad location id", { locationId: "x" }],
    ["a null location id", { locationId: null }],
    ["a status", { status: "approved" }],
    ["malformed JSON", "{not json"],
  ])("answers 400 for %s before any call", async (_name, body) => {
    const response = await approve(body);
    expect(response.status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("answers 404 for a malformed invoice id without calling the database", async () => {
    const response = await (approveRoute.POST as Handler)(
      new Request(`${BASE}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      routeContext({ id: "x" }),
    );
    expect(response.status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("offers no GET, PUT, PATCH or DELETE", () => {
    for (const method of ["GET", "PUT", "PATCH", "DELETE"])
      expect(approveRoute).not.toHaveProperty(method);
  });
});

describe("POST /api/invoices/:id/reject", () => {
  const REJECTED_TABLES: Record<string, FakeResult[]> = {
    invoice: [ok({ ...INVOICE_ROW, status: "rejected" })],
    audit_event: [
      ok({
        action: "invoice.rejected",
        created_at: "2026-10-29T09:12:00+00:00",
        created_by: "a0000000-0000-4000-8000-00000000000a",
        reason: "Merce non ordinata",
        after: null,
      }),
    ],
    app_user: [ok({ display_name: "Titolare Demo" })],
  };

  it("calls reject_invoice with the trimmed reason and returns the review", async () => {
    as("owner", { reject_invoice: ok(null) }, REJECTED_TABLES);
    const response = await reject({ reason: "  Merce non ordinata " });
    expect(response.status).toBe(200);
    expect(procedureCalls(client)).toEqual([
      ["reject_invoice", { p_invoice: INVOICE_ID, p_reason: "Merce non ordinata" }],
    ]);
    const { review } = await response.json();
    expect(review.invoice.status).toBe("rejected");
    expect(review.decision).toEqual({
      action: "rejected",
      at: "2026-10-29T09:12:00+00:00",
      byName: "Titolare Demo",
      reason: "Merce non ordinata",
    });
    expect(review.posting).toBeNull();
  });

  it("passes a null reason when none is given", async () => {
    await reject();
    expect(procedureCalls(client)).toEqual([
      ["reject_invoice", { p_invoice: INVOICE_ID, p_reason: null }],
    ]);
  });

  it("accepts a reason of exactly 200 characters", async () => {
    expect((await reject({ reason: "a".repeat(200) })).status).toBe(200);
  });

  it.each([
    ["201 characters", { reason: "a".repeat(201) }],
    ["a blank reason", { reason: "   " }],
    ["a newline", { reason: "uno\ndue" }],
    ["a bidi override", { reason: "x‮y" }],
    ["a null reason", { reason: null }],
    ["an unknown key", { reason: "x", extra: 1 }],
  ])("answers 400 for %s before any call", async (_name, body) => {
    const response = await reject(body);
    expect(response.status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("maps invalid_request from the database to 400", async () => {
    as("owner", { reject_invoice: dbError("P0001", "invalid_request") });
    const response = await reject({ reason: "x" });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_request");
  });

  it.each([
    ["invoice_already_approved", 409],
    ["invoice_rejected", 409],
    ["invoice_not_in_review", 409],
  ])("maps %s to %i", async (code, status) => {
    as("owner", { reject_invoice: dbError("P0001", code) });
    const response = await reject();
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(code);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("answers 404 for P0002 and 403 for 42501", async () => {
    as("owner", { reject_invoice: dbError("P0002", "not_found") });
    expect((await reject()).status).toBe(404);
    as("owner", { reject_invoice: dbError("42501", "insufficient_privilege") });
    expect((await reject()).status).toBe(403);
  });

  it("answers 500 without database text for an unexpected error", async () => {
    as("owner", { reject_invoice: dbError("XX000", "boom in audit_event") });
    const response = await reject();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toMatch(/boom|audit_event/);
  });

  it.each(["chef", "waiter"])("answers 403 for a %s before any call (AT7)", async (role) => {
    as(role);
    const response = await reject({ reason: "x" });
    expect(response.status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("answers 401 without a session and 415 for text/plain", async () => {
    as("none");
    expect((await reject()).status).toBe(401);
    as("owner");
    const response = await reject("x", { headers: { "content-type": "text/plain" } });
    expect(response.status).toBe(415);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("offers no GET, PUT, PATCH or DELETE", () => {
    for (const method of ["GET", "PUT", "PATCH", "DELETE"])
      expect(rejectRoute).not.toHaveProperty(method);
  });
});

describe("the preview in a refreshed review", () => {
  it("is read after a successful approval, never before the call", async () => {
    as("owner", { approve_invoice: APPROVED_RESULT }, APPROVED_TABLES);
    await approve();
    const names = client.rpc.mock.calls.map(([name]) => name);
    expect(names[0]).toBe("approve_invoice");
    expect(names.slice(1)).toEqual(["invoice_approval_preview"]);
  });
});
