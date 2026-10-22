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

const collection = await import("@/app/api/invoices/route");
const item = await import("@/app/api/invoices/[id]/route");
const { MAX_INVOICE_LIST_ROWS } = await import("@/server/invoices/constants");

const BASE = "http://localhost:3000/api/invoices";
const ID = "1b000000-0000-4000-8000-0000000000b1";
const ROW = {
  id: ID,
  status: "review",
  source: "upload",
  original_filename: "fattura.pdf",
  file_mime: "application/pdf",
  file_size_bytes: 80,
  supplier_vat: "IT12345678903",
  number_raw: "FT 1/2026",
  invoice_date: "2026-10-01",
  duplicate_of: null,
  duplicate_warning_of: null,
  supplier_name: "Fornitore Demo Srl",
  due_date: "2026-11-15",
  net_total: 30,
  vat_total: 3,
  gross_total: 33.06,
  totals_diff: -0.06,
  gate_flags: ["total_mismatch"],
  extraction_error: null,
  attempts: 1,
  extracted_at: "2026-10-22T08:01:00.5+00:00",
  created_at: "2026-10-22T08:00:00.123456+00:00",
};
const ITEM = {
  id: ID,
  status: "review",
  source: "upload",
  originalFilename: "fattura.pdf",
  fileMime: "application/pdf",
  fileSizeBytes: 80,
  supplierVat: "IT12345678903",
  number: "FT 1/2026",
  invoiceDate: "2026-10-01",
  duplicateOf: null,
  duplicateWarningOf: null,
  supplierName: "Fornitore Demo Srl",
  dueDate: "2026-11-15",
  netTotal: 30,
  vatTotal: 3,
  grossTotal: 33.06,
  totalsDiff: -0.06,
  gateFlags: ["total_mismatch"],
  extractionError: null,
  attempts: 1,
  extractedAt: "2026-10-22T08:01:00.5+00:00",
  createdAt: "2026-10-22T08:00:00.123456+00:00",
};
/** Columns that must never leave the server, even if a query selected them by mistake. */
const PRIVATE_COLUMNS = ["extraction_json", "claim_token", "field_confidence", "file_path"];
const ok = (data: unknown): FakeResult => ({ data, error: null });

function as(role: string, invoice: FakeResult[]) {
  client = fakeSupabase({ claims: claimsFor(role), results: { invoice } });
}

beforeEach(() => as("owner", [ok([ROW])]));

describe("GET /api/invoices", () => {
  it("maps rows to camelCase, newest first, capped at the list limit", async () => {
    const response = await collection.GET(new Request(BASE));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ invoices: [ITEM] });
    expect(client.query.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(client.query.limit).toHaveBeenCalledWith(MAX_INVOICE_LIST_ROWS);
    expect(MAX_INVOICE_LIST_ROWS).toBe(100);
    expect(client.query.eq).not.toHaveBeenCalled();
    expect(client.query.lt).not.toHaveBeenCalled();
  });

  it("never selects or returns the storage path", async () => {
    const withPath = { ...ROW, file_path: "tenant/2026/secret.pdf" };
    as("owner", [ok([withPath])]);
    const response = await collection.GET(new Request(BASE));
    const text = await response.text();
    expect(text).not.toMatch(/file_?path|secret\.pdf/i);
    const columns = client.query.select.mock.calls[0]![0] as string;
    expect(columns).not.toContain("file_path");
  });

  it("maps the extraction fields and never selects the private columns", async () => {
    const response = await collection.GET(new Request(BASE));
    const [listed] = (await response.json()).invoices;
    expect(listed).toMatchObject({
      grossTotal: 33.06,
      gateFlags: ["total_mismatch"],
      totalsDiff: -0.06,
      attempts: 1,
    });
    const columns = client.query.select.mock.calls[0]![0] as string;
    for (const column of PRIVATE_COLUMNS) expect(columns).not.toContain(column);
  });

  it("shows a failed extraction with its reason and no totals", async () => {
    const failed = {
      ...ROW,
      status: "extraction_failed",
      extraction_error: "provider_unavailable",
      attempts: 3,
      gross_total: null,
      totals_diff: null,
      gate_flags: [],
      extracted_at: null,
    };
    as("owner", [ok([failed])]);
    const [listed] = (await (await collection.GET(new Request(BASE))).json()).invoices;
    expect(listed).toMatchObject({
      status: "extraction_failed",
      extractionError: "provider_unavailable",
      attempts: 3,
      grossTotal: null,
      totalsDiff: null,
      gateFlags: [],
      extractedAt: null,
    });
  });

  it("never returns extraction_json, claim_token or the path, even if the row carries them", async () => {
    const leaky = {
      ...ROW,
      extraction_json: { secret: "payload" },
      claim_token: "0b000000-0000-4000-8000-000000000001",
      file_path: "tenant/2026/secret.pdf",
    };
    as("owner", [ok([leaky])]);
    const text = await (await collection.GET(new Request(BASE))).text();
    expect(text).not.toMatch(/extraction_?json|claim_?token|file_?path|payload|secret\.pdf/i);
  });

  it("filters by status", async () => {
    await collection.GET(new Request(`${BASE}?status=review`));
    expect(client.query.eq).toHaveBeenCalledWith("status", "review");
  });

  it("uses before as a cursor on created_at, passed through untouched", async () => {
    const before = "2026-10-22T08:00:00.123456+00:00";
    const response = await collection.GET(
      new Request(`${BASE}?before=${encodeURIComponent(before)}`),
    );
    expect(response.status).toBe(200);
    expect(client.query.lt).toHaveBeenCalledWith("created_at", before);
  });

  it.each(["?status=foo", "?before=yesterday", "?before=2026-10-22", "?status="])(
    "answers 400 for %s without querying",
    async (query) => {
      const response = await collection.GET(new Request(`${BASE}${query}`));
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("invalid_request");
      expect(client.from).not.toHaveBeenCalled();
    },
  );

  it("works for an admin", async () => {
    as("admin", [ok([])]);
    const response = await collection.GET(new Request(BASE));
    expect(await response.json()).toEqual({ invoices: [] });
  });

  it.each(["chef", "waiter"])("answers 403 for a %s before any query", async (role) => {
    as(role, [ok([ROW])]);
    expect((await collection.GET(new Request(BASE))).status).toBe(403);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("answers 401 without a session", async () => {
    client = fakeSupabase({ claims: null });
    expect((await collection.GET(new Request(BASE))).status).toBe(401);
  });

  it("answers 500 on an unexpected database error", async () => {
    as("owner", [{ data: null, error: { code: "XX000", message: "boom" } }]);
    expect((await collection.GET(new Request(BASE))).status).toBe(500);
  });
});

describe("GET /api/invoices/:id", () => {
  it("returns the invoice without its storage path", async () => {
    as("owner", [ok({ ...ROW, file_path: "tenant/2026/secret.pdf" })]);
    const response = await item.GET(new Request(`${BASE}/${ID}`), routeContext({ id: ID }));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ invoice: ITEM });
    expect(text).not.toMatch(/file_?path|secret\.pdf/i);
    expect(client.query.eq).toHaveBeenCalledWith("id", ID);
    const columns = client.query.select.mock.calls[0]![0] as string;
    for (const column of PRIVATE_COLUMNS) expect(columns).not.toContain(column);
    expect(text).not.toMatch(/extraction_?json|claim_?token/i);
  });

  it("answers 404 for a missing or other-tenant id (RLS returns no row)", async () => {
    as("owner", [ok(null)]);
    const response = await item.GET(new Request(`${BASE}/${ID}`), routeContext({ id: ID }));
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("not_found");
  });

  it("answers 404 for a malformed id without querying", async () => {
    const response = await item.GET(new Request(`${BASE}/x`), routeContext({ id: "x" }));
    expect(response.status).toBe(404);
    expect(client.from).not.toHaveBeenCalled();
  });

  it.each(["chef", "waiter"])("answers 403 for a %s before any query", async (role) => {
    as(role, [ok(ROW)]);
    const response = await item.GET(new Request(`${BASE}/${ID}`), routeContext({ id: ID }));
    expect(response.status).toBe(403);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("exports no DELETE or PUT handler on either route, and PATCH only on the item (M4 header edit)", () => {
    for (const routeModule of [collection, item]) {
      for (const method of ["DELETE", "PUT"]) expect(routeModule).not.toHaveProperty(method);
    }
    expect(collection).not.toHaveProperty("PATCH");
    expect(item).toHaveProperty("PATCH");
  });
});
