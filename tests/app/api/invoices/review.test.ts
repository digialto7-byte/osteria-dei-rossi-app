import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fakeSupabase,
  routeContext,
  type FakeResult,
  type FakeSupabase,
} from "../../../helpers/fake-supabase";
import { INVOICE_ID, INVOICE_ROW, ok, reviewClient } from "../../../helpers/review-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const route = await import("@/app/api/invoices/[id]/review/route");

const ID = INVOICE_ID;
const URL_ = `http://localhost:3000/api/invoices/${ID}/review`;

function as(role: string, overrides: Record<string, FakeResult[]> = {}) {
  client = reviewClient(role, { tables: overrides });
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
