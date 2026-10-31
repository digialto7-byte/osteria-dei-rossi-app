import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { DISCARDS } from "../../helpers/push-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const route = await import("@/app/api/reports/discards-vs-push/route");
const BASE = "http://localhost:3000/api/reports/discards-vs-push";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

function as(role: string, reply: FakeResult = ok(DISCARDS)) {
  client = fakeSupabase({
    claims: role === "none" ? null : claimsFor(role),
    rpc: { discards_vs_push: [reply] },
  });
}
const get = (query = "") =>
  (route.GET as (r: Request) => Promise<Response>)(new Request(`${BASE}${query}`));

beforeEach(() => as("owner"));

describe("GET /api/reports/discards-vs-push", () => {
  it.each(["owner", "admin"])("%s: exactly one RPC", async (role) => {
    as(role);
    const response = await get("?week=2026-11-04");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(DISCARDS);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("discards_vs_push", { p_week: "2026-11-04" });
  });

  it("no week means the current one", async () => {
    await get();
    expect(client.rpc).toHaveBeenCalledWith("discards_vs_push", { p_week: null });
  });

  it.each(["chef", "waiter"])("%s: 403 before any RPC", async (role) => {
    as(role);
    expect((await get()).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each(["?week=2026-13-04", "?week=x", "?x=1"])("%s is a 400 without any RPC", async (query) => {
    expect((await get(query)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("P0001 date_in_future is a 422", async () => {
    as("owner", failure("P0001", "date_in_future"));
    const response = await get("?week=2030-01-01");
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "date_in_future",
    );
  });

  it("an extra key in a row is a 500", async () => {
    as("owner", ok({ ...DISCARDS, rows: [{ ...DISCARDS.rows[0]!, unit_cost: 1 }] }));
    expect((await get()).status).toBe(500);
  });

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
