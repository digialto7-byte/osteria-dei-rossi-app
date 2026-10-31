import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { AVT } from "../../helpers/report-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/reports/avt/route");
const BASE = "http://localhost:3000/api/reports/avt";
const COUNT = "c5000000-0000-4000-8000-000000000002";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

function as(role: string, reply: FakeResult = ok(AVT)) {
  client = fakeSupabase({
    claims: role === "none" ? null : claimsFor(role),
    rpc: { avt_report: [reply] },
  });
}
const get = (query = "") =>
  (route.GET as (r: Request) => Promise<Response>)(new Request(`${BASE}${query}`));
const code = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

beforeEach(() => {
  reportError.mockClear();
  as("owner");
});

describe("GET /api/reports/avt", () => {
  it.each(["owner", "admin"])("%s: exactly one RPC", async (role) => {
    as(role);
    const response = await get(`?count=${COUNT}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(AVT);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("avt_report", { p_count: COUNT });
  });

  it("no count means the latest one", async () => {
    await get();
    expect(client.rpc).toHaveBeenCalledWith("avt_report", { p_count: null });
  });

  it.each(["chef", "waiter"])("%s: 403 before any RPC", async (role) => {
    as(role);
    expect((await get()).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each(["?count=x", "?count=", "?x=1"])("%s is a 400 without any RPC", async (query) => {
    expect((await get(query)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("P0002 count_not_found is a 404", async () => {
    as("owner", failure("P0002", "count_not_found"));
    const response = await get(`?count=${COUNT}`);
    expect(response.status).toBe(404);
    expect(await code(response)).toBe("not_found");
  });

  it.each(["avt_count_not_monthly", "avt_count_not_closed", "avt_no_opening_count"])(
    "P0001 %s is a 422",
    async (message) => {
      as("owner", failure("P0001", message));
      const response = await get(`?count=${COUNT}`);
      expect(response.status).toBe(422);
      expect(await code(response)).toBe(message);
    },
  );

  it("an injected unit_cost in a row is a 500 and never reaches the JSON", async () => {
    as("owner", ok({ ...AVT, rows: [{ ...AVT.rows[0]!, unit_cost: 12 }] }));
    const response = await get();
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text).error.code).toBe("report_unavailable");
    expect(text).not.toContain("unit_cost");
  });

  it("no session: 401", async () => {
    as("none");
    expect((await get()).status).toBe(401);
  });
});
