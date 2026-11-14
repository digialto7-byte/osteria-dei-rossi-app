import { beforeEach, describe, expect, it, vi } from "vitest";
import { reportError } from "@/lib/observability/report";
import {
  claimsFor,
  fakeSupabase,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import {
  SELL_THROUGH_ATRISK,
  SELL_THROUGH_CHEF,
  SELL_THROUGH_EMPTY,
  SELL_THROUGH_OWNER,
} from "../../helpers/push-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const route = await import("@/app/api/reports/push-sell-through/route");
const BASE = "http://localhost:3000/api/reports/push-sell-through";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

function as(role: string, reply?: FakeResult) {
  const body = role === "chef" ? SELL_THROUGH_CHEF : SELL_THROUGH_OWNER;
  client = fakeSupabase({
    claims: role === "none" ? null : claimsFor(role),
    rpc: { push_sell_through: [reply ?? ok(body)] },
  });
}
const get = (query = "") =>
  (route.GET as (r: Request) => Promise<Response>)(new Request(`${BASE}${query}`));

beforeEach(() => {
  vi.mocked(reportError).mockClear();
  as("owner");
});

describe("GET /api/reports/push-sell-through", () => {
  it.each(["owner", "admin"])("%s: one RPC, the day price is in the reply", async (role) => {
    as(role);
    const response = await get("?date=1998-11-13");
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("push_sell_through", { p_date: "1998-11-13" });
    const body = (await response.json()) as typeof SELL_THROUGH_OWNER;
    expect(body.pushes[0]).toHaveProperty("pushPrice", 12);
    expect(body.pushes[0]!.atRisk[0]).toEqual(SELL_THROUGH_ATRISK);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("server-timing")).toMatch(/rpc;dur=/);
  });

  it("no date: the server picks yesterday (p_date null); the chef has no pushPrice but hasDayRate", async () => {
    as("chef");
    const response = await get();
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith("push_sell_through", { p_date: null });
    const text = JSON.stringify(await response.json());
    expect(text).not.toContain("pushPrice");
    expect(text).toContain("hasDayRate");
  });

  it("an empty day parses", async () => {
    as("owner", ok(SELL_THROUGH_EMPTY));
    expect((await get()).status).toBe(200);
  });

  it("a null sellThroughPct (nothing at start) parses", async () => {
    const card = SELL_THROUGH_OWNER.pushes[0]!;
    const atRisk = [{ ...SELL_THROUGH_ATRISK, atStart: 0, sellThroughPct: null }];
    as("owner", ok({ ...SELL_THROUGH_OWNER, pushes: [{ ...card, atRisk }] }));
    expect((await get()).status).toBe(200);
  });

  it("a waiter gets 403 with no RPC; a signed-out caller 401", async () => {
    as("waiter");
    expect((await get()).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
    as("none");
    expect((await get()).status).toBe(401);
  });

  it("a chef reply with pushPrice is a 500 and the key never reaches the body", async () => {
    as("chef", ok(SELL_THROUGH_OWNER));
    const response = await get();
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).toContain("report_unavailable");
    expect(text).not.toContain("pushPrice");
  });

  it("an owner reply without pushPrice is a 500 as well", async () => {
    as("owner", ok(SELL_THROUGH_CHEF));
    expect((await get()).status).toBe(500);
  });

  it.each([
    "?date=2026-13-01",
    "?date=13-11-1998",
    "?date=",
    "?foo=1",
    "?date=1998-11-13&role=chef",
  ])("%s is a 400 with no RPC", async (query) => {
    expect((await get(query)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("date_in_future is a 422; 42501 a 403; an unexpected error a 500 reported by code only", async () => {
    as("owner", failure("P0001", "date_in_future"));
    expect((await get("?date=2999-01-01")).status).toBe(422);
    as("owner", failure("42501", "permission denied"));
    expect((await get()).status).toBe(403);
    as("owner", failure("XX000", "boom in menu_push"));
    expect((await get()).status).toBe(500);
    const reported = vi.mocked(reportError).mock.calls.map((c) => String((c[0] as Error).message));
    expect(reported).toHaveLength(1);
    expect(reported[0]).toContain("XX000");
    expect(reported[0]).not.toMatch(/menu_push|boom/);
  });
});
