import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import {
  PACK_KPI,
  PACK_WASTE,
  packAvt,
  PACK_COUNT_OCT,
  PACK_COUNT_SEP,
} from "../../fixtures/exports";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: () => undefined }));

const route = await import("@/app/api/exports/monthly-pack/route");
const BASE = "http://localhost:3000/api/exports/monthly-pack";
const ok = (data: unknown): FakeResult => ({ data, error: null });

function as(role: string) {
  client = fakeSupabase({
    claims: role === "none" ? null : claimsFor(role),
    rpc: {
      kpi_report: [ok(PACK_KPI)],
      waste_costs: [ok(PACK_WASTE)],
      avt_report: [ok(packAvt(PACK_COUNT_OCT, [PACK_COUNT_OCT, PACK_COUNT_SEP]))],
    },
  });
}
const get = (query = "") =>
  (route.GET as (r: Request) => Promise<Response>)(new Request(`${BASE}${query}`));

beforeEach(() => as("owner"));

describe("GET /api/exports/monthly-pack", () => {
  it.each(["chef", "waiter"])("%s: 403 and no RPC (AT4)", async (role) => {
    as(role);
    const response = await get("?month=2026-10");
    expect(response.status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session: 401 and no RPC", async () => {
    as("none");
    expect((await get()).status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["?month=2026-13"],
    ["?month=2026-1"],
    ["?mese=2026-10"],
    ["?month=2026-10&month=2026-09"],
    ["?month="],
  ])("%s is a 400 without an RPC", async (query) => {
    const response = await get(query);
    expect(response.status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each(["owner", "admin"])("%s: 200 JSON, no-store, Server-Timing", async (role) => {
    as(role);
    const response = await get("?month=2026-10");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("server-timing")).toMatch(
      /^auth;dur=[\d.]+, rpc;dur=[\d.]+, total;dur=[\d.]+$/,
    );
    const body = (await response.json()) as { month: string; variance: { state: string } };
    expect(body.month).toBe("2026-10");
    expect(body.variance.state).toBe("ok");
    expect(client.rpc).toHaveBeenCalledTimes(3);
  });

  it("no month is allowed", async () => {
    expect((await get()).status).toBe(200);
  });

  it("a future month is the KPI's 422 date_in_future", async () => {
    client = fakeSupabase({
      claims: claimsFor("owner"),
      rpc: { kpi_report: [{ data: null, error: { code: "P0001", message: "date_in_future" } }] },
    });
    const response = await get("?month=2030-01");
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "date_in_future",
    );
  });
});
