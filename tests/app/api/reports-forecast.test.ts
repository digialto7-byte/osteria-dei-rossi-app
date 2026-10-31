import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { FORECAST_CHEF, FORECAST_OWNER } from "../../helpers/push-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const route = await import("@/app/api/reports/forecast/route");
const BASE = "http://localhost:3000/api/reports/forecast";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

function as(role: string, reply?: FakeResult) {
  const body = role === "chef" ? FORECAST_CHEF : { ...FORECAST_OWNER, role };
  client = fakeSupabase({
    claims: role === "none" ? null : claimsFor(role),
    rpc: { forecast: [reply ?? ok(body)] },
  });
}
const get = (query = "") =>
  (route.GET as (r: Request) => Promise<Response>)(new Request(`${BASE}${query}`));

beforeEach(() => as("owner"));

describe("GET /api/reports/forecast", () => {
  it.each(["owner", "admin", "chef"])("%s: exactly one RPC with the date", async (role) => {
    as(role);
    const response = await get("?date=2026-11-05");
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("forecast", { p_date: "2026-11-05" });
  });

  it("no date means today: the database gets null", async () => {
    await get();
    expect(client.rpc).toHaveBeenCalledWith("forecast", { p_date: null });
  });

  it("the owner's reply has covers, the chef's has none", async () => {
    expect(await (await get()).json()).toHaveProperty("covers.expected", 31);
    as("chef");
    expect(await (await get()).json()).not.toHaveProperty("covers");
  });

  it("a waiter gets 403 before any RPC", async () => {
    as("waiter");
    expect((await get()).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("a chef reply that carries covers is a 500 and the key never reaches the body", async () => {
    as("chef", ok({ ...FORECAST_CHEF, covers: { expected: 31 } }));
    const response = await get();
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("covers");
  });

  it("P0001 date_out_of_range is a 422", async () => {
    as("owner", failure("P0001", "date_out_of_range"));
    const response = await get("?date=2026-12-31");
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "date_out_of_range",
    );
  });

  it.each(["?date=2026-13-01", "?date=x", "?week=2026-11-05", "?foo=1"])(
    "%s is a 400 without any RPC",
    async (query) => {
      expect((await get(query)).status).toBe(400);
      expect(client.rpc).not.toHaveBeenCalled();
    },
  );

  it("no session: 401", async () => {
    as("none");
    expect((await get()).status).toBe(401);
  });

  it("answers no-store with a Server-Timing header", async () => {
    const response = await get();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("server-timing")).toMatch(/rpc;dur=/);
  });
});
