import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadInvoiceReview } from "@/server/invoices/review";
import {
  ACTOR_ID,
  APPROVED_TABLES,
  INVOICE_ID,
  INVOICE_ROW,
  LINE_ID,
  LINE_ROW,
  LOCATION_ID,
  dbError,
  ok,
  previewRpc,
  reviewClient,
} from "../../helpers/review-data";
import { ApiError } from "@/lib/api/errors";

const ingredientId = (n: number) => `1d000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("loadInvoiceReview id lookups", () => {
  it("asks for related rows in chunks, so the request URL stays short", async () => {
    const count = 250;
    const lines = Array.from({ length: count }, (_, i) => ({
      ...LINE_ROW,
      id: `11000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      position: i + 1,
      ingredient_id: ingredientId(i + 1),
    }));
    const names = (from: number, to: number) =>
      lines.slice(from, to).map((line) => ({
        id: line.ingredient_id,
        name: `Ingrediente ${line.position}`,
        base_unit: "kg",
      }));
    const client = reviewClient("owner", {
      tables: {
        invoice: [ok(INVOICE_ROW)],
        invoice_line: [ok(lines)],
        ingredient: [ok(names(0, 100)), ok(names(100, 200)), ok(names(200, count))],
      },
    });

    const review = await loadInvoiceReview(client as unknown as SupabaseClient, INVOICE_ID);

    const idLookups = client.query.in.mock.calls.filter(([column]) => column === "id");
    const sizes = idLookups.map(([, ids]) => (ids as string[]).length);
    // One supplier, then the ingredients in 100 + 100 + 50.
    expect(sizes).toEqual([1, 100, 100, 50]);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(100);
    // Every chunk's rows reach the screen.
    expect(review.lines).toHaveLength(count);
    expect(review.lines.every((line) => line.ingredient !== null)).toBe(true);
    expect(review.lines[count - 1]?.ingredient?.name).toBe(`Ingrediente ${count}`);
  });

  it("makes no lookup for an empty id list", async () => {
    const client = reviewClient("owner", {
      tables: { invoice_line: [ok([])], supplier: [ok([])] },
    });
    await loadInvoiceReview(client as unknown as SupabaseClient, INVOICE_ID);
    const tables = client.from.mock.calls.map(([table]) => table);
    expect(tables).not.toContain("ingredient");
    expect(tables).not.toContain("supplier_item");
    expect(tables).not.toContain("cost_centre");
  });
});

const tablesRead = (client: ReturnType<typeof reviewClient>) =>
  client.from.mock.calls.map(([table]) => table as string);
const load = (client: ReturnType<typeof reviewClient>) =>
  loadInvoiceReview(client as unknown as SupabaseClient, INVOICE_ID);

describe("loadInvoiceReview approval data", () => {
  it("asks the database for the preview once for a review invoice, and reads no decision tables", async () => {
    const client = reviewClient("owner", { rpc: previewRpc() });
    const review = await load(client);

    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("invoice_approval_preview", { p_invoice: INVOICE_ID });
    for (const table of ["audit_event", "payable", "raw_lot", "app_user", "location"])
      expect(tablesRead(client)).not.toContain(table);
    expect(review.approval).toMatchObject({ canApprove: true, receipts: 1 });
    expect(review.lines[0]).toMatchObject({
      creditAmount: 0,
      toReceive: { qty: 2, unit: "kg", unitPrice: 5 },
    });
    expect(review.decision).toBeNull();
    expect(review.posting).toBeNull();
  });

  it("reads the decision, payable, location and lots of an approved invoice", async () => {
    const client = reviewClient("owner", {
      tables: APPROVED_TABLES,
      rpc: previewRpc({ ...previewData(), status: "approved" }),
    });
    const review = await load(client);

    expect(tablesRead(client)).toEqual(
      expect.arrayContaining(["audit_event", "app_user", "payable", "location", "raw_lot"]),
    );
    expect(client.query.eq).toHaveBeenCalledWith("entity_id", INVOICE_ID);
    expect(client.query.eq).toHaveBeenCalledWith("action", "invoice.approved");
    expect(client.query.eq).toHaveBeenCalledWith("id", ACTOR_ID);
    expect(client.query.eq).toHaveBeenCalledWith("id", LOCATION_ID);
    expect(client.query.eq).toHaveBeenCalledWith("invoice_id", INVOICE_ID);
    expect(client.query.in).toHaveBeenCalledWith("invoice_line_id", [LINE_ID]);

    expect(review.approval).toBeNull();
    expect(review.decision).toEqual({
      action: "approved",
      at: "2026-10-29T09:12:00+00:00",
      byName: "Titolare Demo",
      reason: null,
    });
    expect(review.posting).toEqual({
      payable: {
        grossAmount: 11,
        creditedAmount: 0,
        amount: 11,
        dueDate: "2026-10-31",
        dueDateSource: "supplier_terms",
        status: "open",
      },
      locationName: "Cella",
    });
    expect(review.lines[0]!.received).toEqual({ qty: 2, unit: "kg" });
  });

  it("reads the lots in chunks of 100 line ids", async () => {
    const lines = Array.from({ length: 250 }, (_, i) => ({
      ...LINE_ROW,
      id: `11000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      position: i + 1,
    }));
    const client = reviewClient("owner", {
      tables: {
        ...APPROVED_TABLES,
        invoice_line: [ok(lines)],
        raw_lot: [ok([]), ok([]), ok([])],
      },
      rpc: previewRpc({ ...previewData(), status: "approved", lines: [] }),
    });
    await load(client);
    const lotCalls = client.query.in.mock.calls.filter(([column]) => column === "invoice_line_id");
    expect(lotCalls.map(([, ids]) => (ids as string[]).length)).toEqual([100, 100, 50]);
  });

  it("reads a rejection's reason and actor but no payable or lots", async () => {
    const client = reviewClient("owner", {
      tables: {
        invoice: [ok({ ...INVOICE_ROW, status: "rejected" })],
        audit_event: [
          ok({
            action: "invoice.rejected",
            created_at: "2026-10-29T09:12:00+00:00",
            created_by: ACTOR_ID,
            reason: "Merce non ordinata",
            after: null,
          }),
        ],
        app_user: [ok({ display_name: "Titolare Demo" })],
      },
      rpc: previewRpc({ ...previewData(), status: "rejected" }),
    });
    const review = await load(client);
    expect(client.query.eq).toHaveBeenCalledWith("action", "invoice.rejected");
    for (const table of ["payable", "raw_lot", "location"])
      expect(tablesRead(client)).not.toContain(table);
    expect(review.decision).toEqual({
      action: "rejected",
      at: "2026-10-29T09:12:00+00:00",
      byName: "Titolare Demo",
      reason: "Merce non ordinata",
    });
    expect(review.posting).toBeNull();
  });

  it("makes no approval call for an invoice that has no reviewed lines yet", async () => {
    const client = reviewClient("owner", {
      tables: { invoice: [ok({ ...INVOICE_ROW, status: "extracting" })], invoice_line: [ok([])] },
    });
    const review = await load(client);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(review.approval).toBeNull();
  });

  it("copes with a decided invoice whose audit row or payable is missing", async () => {
    const client = reviewClient("owner", {
      tables: { ...APPROVED_TABLES, audit_event: [ok(null)], payable: [ok(null)] },
      rpc: previewRpc({ ...previewData(), status: "approved" }),
    });
    const review = await load(client);
    expect(review.decision).toBeNull();
    expect(review.posting).toBeNull();
    expect(tablesRead(client)).not.toContain("app_user");
  });

  it("maps a database error from the preview to an ApiError", async () => {
    const client = reviewClient("owner", {
      rpc: { invoice_approval_preview: [dbError("42501", "insufficient_privilege")] },
    });
    await expect(load(client)).rejects.toMatchObject({ status: 403, code: "forbidden" });
    await expect(load(client)).rejects.toBeInstanceOf(ApiError);
  });

  it("never selects or returns a cost column or a private column (string scan)", async () => {
    const client = reviewClient("owner", {
      tables: APPROVED_TABLES,
      rpc: previewRpc({ ...previewData(), status: "approved" }),
    });
    const text = JSON.stringify(await load(client));
    expect(text).not.toMatch(/file_?path|extraction_?json|claim_?token|last_?price|unit_?cost/i);
    const selected = client.query.select.mock.calls.map((call) => String(call[0]));
    for (const columns of selected)
      expect(columns).not.toMatch(/unit_cost|last_price|file_path|extraction_json|claim_token/);
  });
});

function previewData() {
  return previewRpc().invoice_approval_preview![0]!.data as Record<string, unknown>;
}
