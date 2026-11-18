import { beforeEach, describe, expect, it, vi } from "vitest";
import { OFFLINE_CACHE_PATHS } from "@/lib/api/offline-cache";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  routeContext,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";

// Opening stock step 14 (docs/plans/2026-11-18-opening-stock.md §3.9, §5 step 14): the draft routes. Owner and admin only (roles are also
// enforced in Postgres); strict JSON bodies; one RPC each; never offline-cacheable.
let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const draftRoute = await import("@/app/api/stock/opening/draft/route");
const linesRoute = await import("@/app/api/stock/opening/draft/lines/route");
const lineRoute = await import("@/app/api/stock/opening/draft/lines/[id]/route");

const BASE = "http://localhost:3000/api/stock/opening/draft";
const LOC = "10000000-0000-4000-8000-0000000000a1";
const ING = "1a000000-0000-4000-8000-000000000001";
const ID = "0d000000-0000-4000-8000-000000000001";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string, details: string | null = null): FakeResult => ({
  data: null,
  error: { code, message, details },
});

const LINE = {
  id: ID,
  ingredientId: ING,
  ingredientName: "Farina 00 (demo)",
  baseUnit: "kg",
  qty: 25,
  unitCostEur: 0.8,
  valueEur: 20,
  updatedAt: "2026-12-01T10:00:00+00:00",
  updatedByName: "Titolare Demo",
};
const DRAFT = {
  today: "2026-12-01",
  maxLines: 200,
  booked: false,
  locations: [
    {
      locationId: LOC,
      name: "Dispensa (demo)",
      countedOn: null,
      countOpen: false,
      firstReceiptOn: null,
      bookable: true,
      lines: [LINE],
      lineCount: 1,
      totalValueEur: 20,
    },
  ],
  lineCount: 1,
  totalValueEur: 20,
};
const PUT_LINE = { id: ID, locationId: LOC, ingredientId: ING, qty: 25, unitCostEur: 0.8 };

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({
    claims: claimsFor(role),
    rpc: {
      opening_draft: [ok(DRAFT)],
      opening_draft_put: [ok({ lines: [{ ...LINE, locationId: LOC }] })],
      opening_draft_remove: [ok({ removed: 1 })],
      opening_draft_clear: [ok({ removed: 3 })],
      ...rpc,
    },
  });
}
beforeEach(() => {
  reportError.mockClear();
  as("owner");
});

const getDraft = () => draftRoute.GET(new Request(BASE));
const putLines = (body: unknown = { lines: [PUT_LINE] }, init?: RequestInit) =>
  linesRoute.PUT(jsonRequest(`${BASE}/lines`, body, { method: "PUT", ...init }));
const removeLine = (id = ID) =>
  lineRoute.DELETE(
    jsonRequest(`${BASE}/lines/${id}`, {}, { method: "DELETE" }),
    routeContext({ id }),
  );
const clearDraft = (query = `?locationId=${LOC}`) =>
  draftRoute.DELETE(jsonRequest(`${BASE}${query}`, {}, { method: "DELETE" }));

const calls: [string, () => Promise<Response>][] = [
  ["GET /api/stock/opening/draft", () => getDraft()],
  ["PUT /api/stock/opening/draft/lines", () => putLines()],
  ["DELETE /api/stock/opening/draft/lines/:id", () => removeLine()],
  ["DELETE /api/stock/opening/draft?locationId=", () => clearDraft()],
];

describe("role table", () => {
  it.each(calls)("%s: owner and admin get 200 with one RPC", async (_name, call) => {
    for (const role of ["owner", "admin"]) {
      as(role);
      expect((await call()).status, role).toBe(200);
      expect(client.rpc, role).toHaveBeenCalledTimes(1);
    }
  });

  it.each(calls)("%s: chef and waiter get 403 before any RPC", async (_name, call) => {
    for (const role of ["chef", "waiter"]) {
      as(role);
      expect((await call()).status, role).toBe(403);
      expect(client.rpc, role).not.toHaveBeenCalled();
    }
  });

  it.each(calls)("%s: no session is 401", async (_name, call) => {
    client = fakeSupabase({ claims: null });
    expect((await call()).status).toBe(401);
  });

  it("no opening path is on the offline cache list, and no answer is marked cacheable", async () => {
    expect([...OFFLINE_CACHE_PATHS].filter((p) => p.includes("opening"))).toEqual([]);
    for (const [, call] of calls) {
      as("owner");
      expect((await call()).headers.get("x-offline-cache")).toBeNull();
    }
  });
});

describe("PUT /api/stock/opening/draft/lines", () => {
  it("an owner's PUT of one line calls opening_draft_put once with p_lines and answers 200 {lines}", async () => {
    const response = await putLines();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ lines: [{ ...LINE, locationId: LOC }] });
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("opening_draft_put", { p_lines: [PUT_LINE] });
  });

  it("text/plain is a 415, an oversized body a 413, an extra key a 400, all without an RPC", async () => {
    expect((await putLines("x", { headers: { "content-type": "text/plain" } })).status).toBe(415);
    expect(
      (
        await putLines(
          { lines: [PUT_LINE] },
          {
            headers: {
              "content-type": "application/json",
              "content-length": String(64 * 1024 + 1),
            },
          },
        )
      ).status,
    ).toBe(413);
    expect((await putLines({ lines: [{ ...PUT_LINE, note: "x" }] })).status).toBe(400);
    expect((await putLines({ lines: [PUT_LINE], tenantId: LOC })).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("opening_location_counted is a 409 with details.date; opening_line_duplicate a 422", async () => {
    as("owner", {
      opening_draft_put: [failure("P0001", "opening_location_counted", "2026-12-15")],
    });
    const counted = await putLines();
    expect(counted.status).toBe(409);
    expect((await counted.json()).error).toMatchObject({
      code: "opening_location_counted",
      details: { date: "2026-12-15" },
    });
    as("owner", { opening_draft_put: [failure("P0001", "opening_line_duplicate", ING)] });
    const dup = await putLines();
    expect(dup.status).toBe(422);
    expect((await dup.json()).error.code).toBe("opening_line_duplicate");
  });

  it("an unexpected database error is a 500 that reports the SQLSTATE only", async () => {
    as("owner", { opening_draft_put: [failure("XX000", "boom SEGRETO")] });
    const response = await putLines();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("SEGRETO");
    expect(String(reportError.mock.calls[0]?.[0])).toContain("XX000");
  });
});

describe("GET and DELETE", () => {
  it("GET answers the draft state as the SQL built it", async () => {
    const response = await getDraft();
    expect(await response.json()).toEqual(DRAFT);
    expect(client.rpc).toHaveBeenCalledWith("opening_draft", {});
  });

  it("an undeclared key in the RPC answer is a 500, never a leak", async () => {
    as("owner", { opening_draft: [ok({ ...DRAFT, tenantId: LOC })] });
    expect((await getDraft()).status).toBe(500);
  });

  it("DELETE a line calls opening_draft_remove([id]); a bad uuid is a 404 (as every :id route: it reveals nothing)", async () => {
    const response = await removeLine();
    expect(await response.json()).toEqual({ removed: 1 });
    expect(client.rpc).toHaveBeenCalledWith("opening_draft_remove", { p_ids: [ID] });
    as("owner");
    expect((await removeLine("abc")).status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("DELETE ?locationId= calls opening_draft_clear; a missing or bad locationId is a 400", async () => {
    const response = await clearDraft();
    expect(await response.json()).toEqual({ removed: 3 });
    expect(client.rpc).toHaveBeenCalledWith("opening_draft_clear", { p_location: LOC });
    for (const q of ["", "?locationId=abc", `?locationId=${LOC}&x=1`]) {
      as("owner");
      expect((await clearDraft(q)).status, q).toBe(400);
      expect(client.rpc).not.toHaveBeenCalled();
    }
  });
});
