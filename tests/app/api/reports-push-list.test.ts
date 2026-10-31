import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { PUSH_LIST_CHEF, PUSH_LIST_OWNER } from "../../helpers/push-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const route = await import("@/app/api/reports/push-list/route");
const BASE = "http://localhost:3000/api/reports/push-list";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

function as(role: string, reply?: FakeResult) {
  const body = role === "chef" ? PUSH_LIST_CHEF : { ...PUSH_LIST_OWNER, role };
  client = fakeSupabase({
    claims: role === "none" ? null : claimsFor(role),
    rpc: { push_list: [reply ?? ok(body)] },
  });
}
const get = (query = "") =>
  (route.GET as (r: Request) => Promise<Response>)(new Request(`${BASE}${query}`));

beforeEach(() => as("owner"));

describe("GET /api/reports/push-list", () => {
  it.each(["owner", "admin", "chef"])("%s: exactly one RPC", async (role) => {
    as(role);
    const response = await get();
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("push_list");
    expect(((await response.json()) as { role: string }).role).toBe(role);
  });

  it("the owner's rows carry the cost at risk, the chef's do not", async () => {
    const owner = (await (await get()).json()) as { rows: Record<string, unknown>[] };
    expect(owner.rows[1]).toHaveProperty("costAtRiskEur", 38.0002);
    as("chef");
    const chef = (await (await get()).json()) as { rows: Record<string, unknown>[] };
    expect(chef.rows[0]).not.toHaveProperty("costAtRiskEur");
    expect(JSON.stringify(chef)).not.toMatch(/costAtRisk|pushPrice|Eur/);
  });

  it("a waiter gets 403 before any RPC", async () => {
    as("waiter");
    expect((await get()).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("answers no-store with a Server-Timing header", async () => {
    const response = await get();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("server-timing")).toMatch(/rpc;dur=/);
  });

  it("a chef reply that carries a cost at risk is a 500 and the key never reaches the body", async () => {
    as("chef", ok({ ...PUSH_LIST_CHEF, rows: [{ ...PUSH_LIST_CHEF.rows[0]!, costAtRiskEur: 9 }] }));
    const response = await get();
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).toContain("report_unavailable");
    expect(text).not.toContain("costAtRiskEur");
  });

  it("a chef reply that carries a push price on a plate is a 500", async () => {
    const row = PUSH_LIST_CHEF.rows[0]!;
    const rows = [{ ...row, plates: row.plates.map((p) => ({ ...p, pushPrice: 12 })) }];
    as("chef", ok({ ...PUSH_LIST_CHEF, rows }));
    expect((await get()).status).toBe(500);
  });

  it("an owner reply without the cost keys is a 500 as well", async () => {
    as("owner", ok({ ...PUSH_LIST_CHEF, role: "owner" }));
    expect((await get()).status).toBe(500);
  });

  it("a database error is mapped, and an unexpected one is a 500", async () => {
    as("owner", failure("42501", "permission denied"));
    expect((await get()).status).toBe(403);
    as("owner", failure("XX000", "boom"));
    expect((await get()).status).toBe(500);
  });

  it.each(["?foo=1", "?role=chef"])("%s is a 400 without any RPC", async (query) => {
    expect((await get(query)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session: 401", async () => {
    as("none");
    expect((await get()).status).toBe(401);
  });
});
