import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { adminDashboardSchema, ownerDashboardSchema } from "@/server/dashboard/output";
import { adminSql, ownerSql } from "../../fixtures/dashboard-sql";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/dashboard/route");
const BASE = "http://localhost:3000/api/dashboard";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

function as(role: string, reply?: FakeResult) {
  client = fakeSupabase({
    claims: role === "none" ? null : claimsFor(role),
    rpc: {
      dashboard_summary: [reply ?? ok(role === "admin" ? adminSql() : ownerSql())],
    },
  });
}
const get = (query = "") =>
  (route.GET as (r: Request) => Promise<Response>)(new Request(`${BASE}${query}`));
const TIMING = /^auth;dur=\d+(\.\d)?, rpc;dur=\d+(\.\d)?, total;dur=\d+(\.\d)?$/;

beforeEach(() => reportError.mockClear());

describe("GET /api/dashboard: who", () => {
  it.each(["owner", "admin"])("%s: exactly one RPC and no table read", async (role) => {
    as(role);
    const response = await get();
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("dashboard_summary");
    expect(client.from).not.toHaveBeenCalled();
  });

  it.each(["chef", "waiter"])("%s: 403 before any RPC", async (role) => {
    as(role);
    const response = await get();
    expect(response.status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("no session: 401, nothing read", async () => {
    as("none");
    expect((await get()).status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each(["?x=1", "?locale=en", "?filter=open"])(
    "a query string (%s) is a 400 without an RPC",
    async (query) => {
      as("owner");
      const response = await get(query);
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        "invalid_request",
      );
      expect(client.rpc).not.toHaveBeenCalled();
    },
  );
});

describe("GET /api/dashboard: errors", () => {
  it("SQLSTATE 42501 from the database is a 403", async () => {
    as("owner", failure("42501", "insufficient_privilege"));
    expect((await get()).status).toBe(403);
  });

  it("any other error is a 500 dashboard_unavailable with no SQL text, logged by code", async () => {
    as("owner", failure("XX000", 'relation "secret_table" does not exist'));
    const response = await get();
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text).error.code).toBe("dashboard_unavailable");
    expect(text).not.toContain("secret_table");
    expect(reportError).toHaveBeenCalledTimes(1);
    const reported = String((reportError.mock.calls[0]?.[0] as Error).message);
    expect(reported).toContain("XX000");
    expect(reported).not.toContain("secret_table");
  });

  it("a malformed document (an admin document with fixedCosts) is a 500, never passed on", async () => {
    as("admin", ok({ ...adminSql(), fixedCosts: ownerSql().fixedCosts }));
    const response = await get();
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text).error.code).toBe("dashboard_unavailable");
    expect(text).not.toContain("3000");
  });

  it("a document whose role is not the caller's is a 500", async () => {
    as("admin", ok(ownerSql()));
    expect((await get()).status).toBe(500);
  });

  it("a null document is a 500", async () => {
    as("owner", ok(null));
    expect((await get()).status).toBe(500);
  });
});

describe("GET /api/dashboard: output", () => {
  it("owner: validates against ownerDashboardSchema, with the owner tiles", async () => {
    as("owner");
    const body = await (await get()).json();
    expect(ownerDashboardSchema.parse(body)).toEqual(body);
    expect(Object.keys(body.tiles)).toContain("fixedCosts");
  });

  it("admin: validates against adminDashboardSchema, with no fixedCosts, priceVariance or todayLists", async () => {
    as("admin");
    const body = await (await get()).json();
    expect(adminDashboardSchema.parse(body)).toEqual(body);
    const tiles = Object.keys(body.tiles);
    for (const key of ["fixedCosts", "priceVariance", "todayLists"]) {
      expect(tiles).not.toContain(key);
    }
    expect(JSON.stringify(body)).not.toMatch(/fixed|rent|labour|utilit|perPlate/i);
  });

  it("an injected unit_cost key in a plate row of the reply is dropped from the JSON", async () => {
    const doc = ownerSql();
    (doc.plates.worst[0] as Record<string, unknown>).unit_cost = 1.5;
    as("owner", ok(doc));
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("unit_cost");
  });

  it("sends no-store and a Server-Timing header with auth, rpc and total", async () => {
    as("owner");
    const response = await get();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("server-timing")).toMatch(TIMING);
  });
});
