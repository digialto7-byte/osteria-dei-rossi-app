import { beforeEach, describe, expect, it, vi } from "vitest";
import { routeContext, type FakeResult, type FakeSupabase } from "../../../helpers/fake-supabase";
import {
  INVOICE_ID,
  LINE_ID,
  INGREDIENT_ID,
  CENTRE_ID,
  dbError,
  ok,
  procedureCalls,
  reviewClient,
} from "../../../helpers/review-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const route = await import("@/app/api/invoices/[id]/lines/[lineId]/route");

const URL_ = `http://localhost:3000/api/invoices/${INVOICE_ID}/lines/${LINE_ID}`;
const context = routeContext({ id: INVOICE_ID, lineId: LINE_ID });

const patch = (body: unknown, init: RequestInit = {}) =>
  route.PATCH(
    new Request(URL_, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
      ...init,
    }),
    context,
  );

function as(
  role: string,
  rpcResult: FakeResult = ok(null),
  tables: Record<string, FakeResult[]> = {},
) {
  client = reviewClient(role, { rpc: { review_update_line: [rpcResult] }, tables });
}

beforeEach(() => as("owner"));

describe("PATCH /api/invoices/:id/lines/:lineId", () => {
  it("calls the procedure once with snake_case keys and returns the refreshed review", async () => {
    const response = await patch({
      qty: 3,
      unitPrice: 4.5,
      lineAmount: 13.5,
      vatRate: 10,
      supplierCode: "MAN-2",
      unit: "kg",
      lotCode: "L42",
      expiry: "2026-12-01",
      reviewed: true,
    });
    expect(response.status).toBe(200);
    expect(procedureCalls(client)).toHaveLength(1);
    expect(client.rpc).toHaveBeenCalledWith("review_update_line", {
      p_invoice: INVOICE_ID,
      p_line: LINE_ID,
      p_patch: {
        qty: 3,
        unit_price: 4.5,
        line_amount: 13.5,
        vat_rate: 10,
        supplier_code: "MAN-2",
        unit: "kg",
        lot_code: "L42",
        expiry: "2026-12-01",
        reviewed: true,
      },
    });
    const body = await response.json();
    expect(body.review.lines[0].rawDescription).toBe("Fesa di manzo");
    expect(JSON.stringify(body)).not.toMatch(
      /file_?path|extraction_?json|claim_?token|last_?price/i,
    );
  });

  it("maps a mapping with a pack, an unmap and a non-stock booking", async () => {
    await patch({
      ingredientId: INGREDIENT_ID,
      pack: { count: 6, size: 1, unit: "kg", label: "cassa" },
    });
    await patch({ ingredientId: null });
    await patch({ isStock: false, costCentreId: CENTRE_ID });
    const patches = procedureCalls(client).map((call) => (call[1] as { p_patch: unknown }).p_patch);
    expect(patches).toEqual([
      { ingredient_id: INGREDIENT_ID, pack: { count: 6, size: 1, unit: "kg", label: "cassa" } },
      { ingredient_id: null },
      { is_stock: false, cost_centre_id: CENTRE_ID },
    ]);
  });

  it("answers 422 cost_centre_required before any database call (AT4)", async () => {
    const response = await patch({ isStock: false });
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("cost_centre_required");
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("answers 422 when the credit exceeds the qty in the same body (AT4)", async () => {
    const response = await patch({ qty: 2, creditQty: 3 });
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("credit_qty_exceeds_qty");
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("checks a credit against the stored qty when the body has none (AT4)", async () => {
    as("owner", ok(null), { invoice_line: [ok({ qty: 2 }), ok([])] });
    const response = await patch({ creditQty: 3 });
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("credit_qty_exceeds_qty");
    expect(client.query.eq).toHaveBeenCalledWith("id", LINE_ID);
    expect(client.query.eq).toHaveBeenCalledWith("invoice_id", INVOICE_ID);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("accepts a credit equal to the stored qty", async () => {
    as("owner", ok(null), { invoice_line: [ok({ qty: "2.0000" }), ok([])] });
    expect((await patch({ creditQty: 2 })).status).toBe(200);
    expect(procedureCalls(client)).toHaveLength(1);
  });

  it("answers 404 for a credit on a line that is not visible", async () => {
    as("owner", ok(null), { invoice_line: [ok(null)] });
    expect((await patch({ creditQty: 1 })).status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["invoice_not_in_review", 409],
    ["line_split", 409],
    ["split_child_locked", 422],
    ["supplier_required", 422],
    ["pack_required", 422],
    ["non_stock_has_ingredient", 422],
    ["not_mapped", 422],
    ["credit_qty_exceeds_qty", 422],
    ["cost_centre_required", 422],
  ])("maps the procedure error %s to %i", async (code, status) => {
    as("owner", dbError("P0001", code));
    const response = await patch({ qty: 1 });
    expect(response.status).toBe(status);
    const { error } = await response.json();
    expect(error.code).toBe(code);
    expect(error.message).not.toContain(code);
  });

  it("maps incompatible units, a foreign id and a missing line", async () => {
    as("owner", dbError("22023", "incompatible_units"));
    expect(
      (await (await patch({ pack: { count: 1, size: 1, unit: "kg" } })).json()).error.code,
    ).toBe("incompatible_units");
    as("owner", dbError("23503", 'violates foreign key constraint "invoice_line_ingredient_fk"'));
    expect((await patch({ ingredientId: INGREDIENT_ID })).status).toBe(422);
    as("owner", dbError("P0002", "not_found"));
    expect((await patch({ qty: 1 })).status).toBe(404);
  });

  it("answers 500 without the database text on an unexpected error", async () => {
    as("owner", dbError("XX000", "relation secret_table exploded"));
    const response = await patch({ qty: 1 });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret_table");
  });

  it.each([
    ["an empty body", {}],
    ["an unknown key", { qty: 1, nope: true }],
    ["a negative qty", { qty: -1 }],
    ["five decimals", { unitPrice: 1.23456 }],
    ["a 65-char lot code", { lotCode: "x".repeat(65) }],
  ])("answers 400 for %s without calling the database", async (_name, body) => {
    const response = await patch(body);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_request");
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("answers 400 for invalid JSON and 415 for a text body", async () => {
    expect((await patch("{nope")).status).toBe(400);
    const text = await patch("qty=1", { headers: { "content-type": "text/plain" } });
    expect(text.status).toBe(415);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each(["chef", "waiter"])("answers 403 for a %s before any call", async (role) => {
    as(role);
    expect((await patch({ qty: 1 })).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("works for an admin and answers 401 without a session", async () => {
    as("admin");
    expect((await patch({ reviewed: true })).status).toBe(200);
    as("none");
    expect((await patch({ reviewed: true })).status).toBe(401);
  });

  it("answers 404 for malformed ids without calling the database", async () => {
    const response = await route.PATCH(
      new Request(URL_, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ qty: 1 }),
      }),
      routeContext({ id: INVOICE_ID, lineId: "x" }),
    );
    expect(response.status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("exports only PATCH", () => {
    for (const method of ["GET", "POST", "PUT", "DELETE"]) expect(route).not.toHaveProperty(method);
  });
});
