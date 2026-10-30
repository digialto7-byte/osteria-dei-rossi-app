import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { REPORT, REPORT_NO_REGISTER } from "../../helpers/bill-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/reports/app-vs-register/route");
const URL_ = "http://localhost:3000/api/reports/app-vs-register";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({
    claims: claimsFor(role),
    rpc: { app_vs_register: [ok(REPORT)], ...rpc },
  });
}
const get = (query = "") => route.GET(new Request(URL_ + query));

beforeEach(() => {
  reportError.mockClear();
  as("owner");
});

describe("GET /api/reports/app-vs-register", () => {
  it.each(["owner", "admin"])(
    "%s reads the report with one RPC (today when no date is given)",
    async (role) => {
      as(role);
      const response = await get();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(REPORT);
      expect(client.rpc).toHaveBeenCalledTimes(1);
      expect(client.rpc).toHaveBeenCalledWith("app_vs_register", { p_date: null });
    },
  );

  it("passes the date through", async () => {
    await get("?date=2026-11-04");
    expect(client.rpc).toHaveBeenCalledWith("app_vs_register", { p_date: "2026-11-04" });
  });

  it("is never cached", async () => {
    expect((await get()).headers.get("cache-control")).toBe("no-store");
  });

  it("a report without a register entry has register and difference null", async () => {
    as("owner", { app_vs_register: [ok(REPORT_NO_REGISTER)] });
    const body = await (await get()).json();
    expect([body.register, body.difference]).toEqual([null, null]);
  });

  it.each(["waiter", "chef"])("a %s gets 403 before any RPC", async (role) => {
    as(role);
    expect((await get()).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401", async () => {
    client = fakeSupabase({ claims: null });
    expect((await get()).status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([["?date=2026-13-01"], ["?date=x"], ["?x=1"]])(
    "%s is a 400 without any RPC",
    async (query) => {
      expect((await get(query)).status).toBe(400);
      expect(client.rpc).not.toHaveBeenCalled();
    },
  );

  it("business_date_invalid is a 422", async () => {
    as("owner", { app_vs_register: [failure("P0001", "business_date_invalid")] });
    const response = await get("?date=2020-01-01");
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("business_date_invalid");
  });

  it("a key injected into the report is a 500 and never reaches the JSON", async () => {
    as("owner", { app_vs_register: [ok({ ...REPORT, cost: 1 })] });
    const response = await get();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('"cost"');
  });
});
