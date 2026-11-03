import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { SERVICES_REPORT } from "../../helpers/services-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));
const parseQuerySpy = vi.hoisted(() => vi.fn());
vi.mock("@/server/counts/schemas", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/counts/schemas")>();
  parseQuerySpy.mockImplementation(actual.parseQuery);
  return { ...actual, parseQuery: parseQuerySpy };
});

const route = await import("@/app/api/reports/services/route");
const { periodQuery } = await import("@/server/reports/schemas");
const BASE = "http://localhost:3000/api/reports/services";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

function as(role: string, reply: FakeResult = ok(SERVICES_REPORT)) {
  client = fakeSupabase({
    claims: role === "none" ? null : claimsFor(role),
    rpc: { kpi_services: [reply] },
  });
}
const get = (query = "") =>
  (route.GET as (r: Request) => Promise<Response>)(new Request(`${BASE}${query}`));
const code = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

beforeEach(() => {
  reportError.mockClear();
  parseQuerySpy.mockClear();
  as("owner");
});

describe("GET /api/reports/services", () => {
  it.each(["owner", "admin"])("%s: exactly one RPC with the parsed parameters", async (role) => {
    as(role);
    const response = await get("?period=week&date=2026-11-04");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(SERVICES_REPORT);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("kpi_services", {
      p_period: "week",
      p_date: "2026-11-04",
      p_from: null,
      p_to: null,
    });
    expect(client.from).not.toHaveBeenCalled();
  });

  it("parses the query with the very periodQuery object of the KPI report (same rules, same 400s)", async () => {
    await get("?period=day");
    expect(parseQuerySpy).toHaveBeenCalledTimes(1);
    expect(parseQuerySpy.mock.calls[0]![0]).toBe(periodQuery);
  });

  it("no query means the day period and the database's default date", async () => {
    await get();
    expect(client.rpc).toHaveBeenCalledWith("kpi_services", {
      p_period: "day",
      p_date: null,
      p_from: null,
      p_to: null,
    });
  });

  it("a custom range passes both ends", async () => {
    await get("?period=custom&from=2026-11-01&to=2026-11-07");
    expect(client.rpc).toHaveBeenCalledWith("kpi_services", {
      p_period: "custom",
      p_date: null,
      p_from: "2026-11-01",
      p_to: "2026-11-07",
    });
  });

  it.each(["chef", "waiter"])("%s: 403 before any RPC", async (role) => {
    as(role);
    expect((await get()).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session: 401, nothing read", async () => {
    as("none");
    expect((await get()).status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    "?period=custom&from=2026-11-01",
    "?period=custom",
    "?period=day&from=2026-11-01&to=2026-11-02",
    "?period=year",
    "?foo=1",
    "?date=2026-13-01",
    "?period=day&period=week",
  ])("%s is a 400 without any RPC", async (query) => {
    expect((await get(query)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each(["range_invalid", "range_too_long", "date_in_future"])(
    "P0001 %s is a 422",
    async (message) => {
      as("owner", failure("P0001", message));
      const response = await get("?period=custom&from=2026-11-01&to=2026-11-07");
      expect(response.status).toBe(422);
      expect(await code(response)).toBe(message);
    },
  );

  it("an unexpected database error is a 500 report_unavailable that names no message", async () => {
    as("owner", failure("XX000", "secret internals"));
    const response = await get();
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text).error.code).toBe("report_unavailable");
    expect(text).not.toContain("secret");
  });

  it("is never cached and carries the Server-Timing header", async () => {
    const response = await get();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("server-timing")).toMatch(
      /^auth;dur=\d+(\.\d)?, rpc;dur=\d+(\.\d)?, total;dur=\d+(\.\d)?$/,
    );
  });

  it("an injected key (a cost per portion, a fixed cost) is a 500 report_unavailable and never reaches the JSON", async () => {
    as("owner", ok({ ...SERVICES_REPORT, total: { ...SERVICES_REPORT.total, fixedCostEur: 12 } }));
    const response = await get();
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text).error.code).toBe("report_unavailable");
    expect(text).not.toContain("fixedCost");
  });

  it("null ratios (a service without data) are accepted", async () => {
    const empty = structuredClone(SERVICES_REPORT);
    Object.assign(empty.services[0]!, {
      covers: 0,
      tables: 0,
      avgSpendPerCoverEur: null,
      avgTicketEur: null,
      foodCostPct: null,
      costedSharePct: null,
    });
    as("owner", ok(empty));
    expect((await get()).status).toBe(200);
  });

  it("a removed service has position null", async () => {
    const removed = structuredClone(SERVICES_REPORT);
    removed.services[1]!.position = null;
    as("owner", ok(removed));
    expect((await get()).status).toBe(200);
  });
});
