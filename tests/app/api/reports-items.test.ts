import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { ITEMS_ADMIN, ITEMS_OWNER } from "../../helpers/report-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/reports/items/route");
const BASE = "http://localhost:3000/api/reports/items";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

function as(role: string, reply?: FakeResult) {
  client = fakeSupabase({
    claims: role === "none" ? null : claimsFor(role),
    rpc: { kpi_items: [reply ?? ok(role === "admin" ? ITEMS_ADMIN : ITEMS_OWNER)] },
  });
}
const get = (query = "") =>
  (route.GET as (r: Request) => Promise<Response>)(new Request(`${BASE}${query}`));

beforeEach(() => {
  reportError.mockClear();
  as("owner");
});

describe("GET /api/reports/items", () => {
  it.each([
    ["owner", ITEMS_OWNER],
    ["admin", ITEMS_ADMIN],
  ])("%s: exactly one RPC with the parsed parameters", async (role, expected) => {
    as(role);
    const response = await get("?period=month&date=2026-11-04");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expected);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("kpi_items", {
      p_period: "month",
      p_date: "2026-11-04",
      p_from: null,
      p_to: null,
    });
  });

  it.each(["chef", "waiter"])("%s: 403 before any RPC", async (role) => {
    as(role);
    expect((await get()).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("the owner's reply carries the fixed-cost keys, the admin's does not", async () => {
    const owner = await (await get()).json();
    expect(owner.rows[0]).toHaveProperty("contributionEur");
    as("admin");
    const admin = await (await get()).json();
    expect(JSON.stringify(admin)).not.toMatch(/fixedCost|grossMargin|contribution/);
  });

  it("an admin reply carrying fixedCostPerPlateEur is a 500 report_unavailable, with the key absent from the body", async () => {
    const leaked = { ...ITEMS_ADMIN, rows: [{ ...ITEMS_ADMIN.rows[0]!, fixedCostPerPlateEur: 5 }] };
    as("admin", ok(leaked));
    const response = await get();
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text).error.code).toBe("report_unavailable");
    expect(text).not.toContain("fixedCostPerPlateEur");
  });

  it("a reply whose role is not the caller's is a 500 as well", async () => {
    as("admin", ok(ITEMS_OWNER));
    const response = await get();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("contribution");
  });

  it("an injected unit_cost is a 500", async () => {
    const leaked = { ...ITEMS_OWNER, rows: [{ ...ITEMS_OWNER.rows[0]!, unit_cost: 4.2 }] };
    as("owner", ok(leaked));
    const response = await get();
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("unit_cost");
  });

  it.each(["?period=custom&from=2026-11-01", "?period=year", "?x=1"])(
    "%s is a 400 without any RPC",
    async (query) => {
      expect((await get(query)).status).toBe(400);
      expect(client.rpc).not.toHaveBeenCalled();
    },
  );

  it("P0001 range_too_long is a 422", async () => {
    as("owner", failure("P0001", "range_too_long"));
    expect((await get("?period=custom&from=2025-01-01&to=2026-11-01")).status).toBe(422);
  });

  it("no session: 401", async () => {
    as("none");
    expect((await get()).status).toBe(401);
  });
});
