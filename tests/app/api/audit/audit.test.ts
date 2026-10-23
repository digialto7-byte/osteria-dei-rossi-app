import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  type FakeResult,
  type FakeSupabase,
} from "../../../helpers/fake-supabase";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const auditRoute = await import("@/app/api/audit/route");

const URL_BASE = "http://localhost:3000/api/audit";
const ING = "1a000000-0000-4000-8000-00000000001a";
const ID1 = "0e000000-0000-4000-8000-0000000000e1";
const ID2 = "0e000000-0000-4000-8000-0000000000e2";

const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

const STOCK_ENTRY = {
  id: ID1,
  at: "2026-10-22T08:10:00+00:00",
  byName: "Chef Demo",
  kind: "stock",
  action: "waste",
  ingredientId: ING,
  ingredientName: "Manzo muscolo (demo)",
  qty: -1.5,
  unit: "kg",
  reasonCode: "spoilage",
  locationNames: ["Cella (demo)"],
};
const EVENT_ENTRY = {
  id: ID2,
  at: "2026-10-22T08:00:00+00:00",
  byName: "Titolare Demo",
  kind: "event",
  action: "invoice.approved",
  entityType: "invoice",
  entityId: "e1000000-0000-4000-8000-0000000000e1",
  entityLabel: "FT-123/A",
};
const LOG = {
  from: "2026-10-01",
  to: "2026-10-22",
  entries: [STOCK_ENTRY, EVENT_ENTRY],
  nextCursor: null,
};

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({ claims: claimsFor(role), rpc: { audit_log: [ok(LOG)], ...rpc } });
}
beforeEach(() => {
  reportError.mockClear();
  as("owner");
});
const get = (query = "") => auditRoute.GET(new Request(`${URL_BASE}${query}`));

describe("GET /api/audit", () => {
  it("owner and admin get 200", async () => {
    for (const role of ["owner", "admin"]) {
      as(role);
      const response = await get();
      expect(response.status, role).toBe(200);
      expect(await response.json()).toEqual(LOG);
    }
  });

  it("the chef and the waiter get 403 before any RPC, no session 401", async () => {
    for (const role of ["chef", "waiter"]) {
      as(role);
      expect((await get()).status, role).toBe(403);
      expect(client.rpc).not.toHaveBeenCalled();
    }
    client = fakeSupabase({ claims: null });
    expect((await get()).status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("calls audit_log with the parsed parameters", async () => {
    const before = `2026-10-22T08:10:00+00:00_${ID1}`;
    await get(`?from=2026-10-01&to=2026-10-22&kind=stock&before=${encodeURIComponent(before)}`);
    expect(client.rpc).toHaveBeenCalledWith("audit_log", {
      p_from: "2026-10-01",
      p_to: "2026-10-22",
      p_kind: "stock",
      p_before_at: "2026-10-22T08:10:00+00:00",
      p_before_id: ID1,
      p_limit: 50,
    });
  });

  it("without parameters the database applies the Rome month", async () => {
    await get();
    expect(client.rpc).toHaveBeenCalledWith("audit_log", {
      p_from: null,
      p_to: null,
      p_kind: "all",
      p_before_at: null,
      p_before_id: null,
      p_limit: 50,
    });
  });

  it("turns the SQL cursor into <at>_<id>", async () => {
    as("owner", { audit_log: [ok({ ...LOG, nextCursor: { at: STOCK_ENTRY.at, id: ID1 } })] });
    expect((await (await get()).json()).nextCursor).toBe(`${STOCK_ENTRY.at}_${ID1}`);
  });

  it.each([
    "?kind=x",
    "?unknown=1",
    "?before=nope",
    `?before=${encodeURIComponent("2026-10-22T08:10:00Z_" + ID1 + "'")}`,
  ])("answers 400 for %s without an RPC", async (query) => {
    expect((await get(query)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("the response has no before, after or reason key and no cost-like key, whatever the RPC returned", async () => {
    as("owner", {
      audit_log: [
        ok({
          ...LOG,
          entries: [
            {
              ...STOCK_ENTRY,
              before: { x: 1 },
              after: { x: 2 },
              reason: "free text",
              unit_cost: 10,
            },
            { ...EVENT_ENTRY, before: { a: 1 }, valueEur: 5 },
          ],
        }),
      ],
    });
    const text = await (await get()).text();
    expect(text).not.toMatch(/"(before|after|reason)"\s*:/);
    expect(text).not.toMatch(/"[^"]*(cost|price|eur|value|amount|margin)[^"]*"\s*:/i);
    expect(text).not.toContain("€");
  });

  it.each([
    ["P0001", "range_invalid", 422],
    ["P0001", "range_too_long", 422],
    ["42501", "permission denied: the activity log needs owner or admin", 403],
    ["22023", "invalid_request", 400],
  ])("maps %s %s to %i", async (code, message, status) => {
    as("owner", { audit_log: [failure(code, message)] });
    expect((await get()).status).toBe(status);
  });

  it("an unexpected database error is a 500 that is reported with the SQLSTATE only", async () => {
    as("owner", { audit_log: [failure("XX000", "boom Chef Demo")] });
    const response = await get();
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("Chef Demo");
    expect(reportError).toHaveBeenCalledTimes(1);
    expect((reportError.mock.calls[0]![0] as Error).message).toBe(
      "Unexpected database error XX000",
    );
  });
});
