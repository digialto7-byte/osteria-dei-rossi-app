import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { KPI_REPORT } from "../../helpers/report-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/reports/kpis/route");
const BASE = "http://localhost:3000/api/reports/kpis";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const BUSINESS_DATE = "2025-01-15";
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

function as(
  role: string,
  reply: FakeResult = ok(KPI_REPORT),
  businessDate: FakeResult = ok(BUSINESS_DATE),
) {
  client = fakeSupabase({
    claims: role === "none" ? null : claimsFor(role),
    rpc: { kpi_report: [reply], business_date_of: [businessDate] },
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

describe("GET /api/reports/kpis", () => {
  it.each(["owner", "admin"])(
    "%s: the report RPC with the parsed parameters, and the business date",
    async (role) => {
      as(role);
      const response = await get("?period=week&date=2026-11-04");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ...KPI_REPORT, businessDate: BUSINESS_DATE });
      expect(client.rpc).toHaveBeenCalledTimes(2);
      expect(client.rpc).toHaveBeenCalledWith("kpi_report", {
        p_period: "week",
        p_date: "2026-11-04",
        p_from: null,
        p_to: null,
      });
      expect(client.from).not.toHaveBeenCalled();
    },
  );

  it("a huge delta (tiny previous value) still answers 200, not 500", async () => {
    const reply = {
      ...KPI_REPORT,
      delta: {
        ...KPI_REPORT.delta,
        wasteEur: { abs: 49.96, pct: 124900.0 },
        covers: { abs: -5, pct: -250000.5 },
      },
    };
    as("owner", ok(reply));
    const response = await get("?period=day");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...reply, businessDate: BUSINESS_DATE });
    expect(reportError).not.toHaveBeenCalled();
  });

  it("no query means the day period and the database's default date", async () => {
    await get();
    expect(client.rpc).toHaveBeenCalledWith("kpi_report", {
      p_period: "day",
      p_date: null,
      p_from: null,
      p_to: null,
    });
  });

  it("a custom range passes both ends", async () => {
    await get("?period=custom&from=2026-11-01&to=2026-11-07");
    expect(client.rpc).toHaveBeenCalledWith("kpi_report", {
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
    expect(client.from).not.toHaveBeenCalled();
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
    "?date=2026-13-01",
    "?x=1",
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

  it("is never cached and carries the Server-Timing header", async () => {
    const response = await get();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("server-timing")).toMatch(
      /^auth;dur=\d+(\.\d)?, rpc;dur=\d+(\.\d)?, total;dur=\d+(\.\d)?$/,
    );
  });

  it("an injected key is a 500 report_unavailable and never reaches the JSON", async () => {
    as("owner", ok({ ...KPI_REPORT, unit_cost: 4.2 }));
    const response = await get();
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text).error.code).toBe("report_unavailable");
    expect(text).not.toContain("unit_cost");
  });

  it("any other database error is a 500 report_unavailable with no SQL text, logged by code", async () => {
    as("owner", failure("XX000", 'relation "secret_table" does not exist'));
    const response = await get();
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text).error.code).toBe("report_unavailable");
    expect(text).not.toContain("secret_table");
    const reported = String((reportError.mock.calls[0]?.[0] as Error).message);
    expect(reported).toContain("XX000");
    expect(reported).not.toContain("secret_table");
  });
});

// The venue's business date rides along on every reply (lead, report picker max): SQL decides it through business_date_of at the request instant,
// so between 00:00 and the 02:00 cut-off (Rome) it is the previous day. The instants are 2025 dates (the date-bomb guard's 400-day window).
describe("GET /api/reports/kpis: the venue's business date", () => {
  afterEach(() => vi.useRealTimers());

  it.each([
    ["00:30 Rome, before the cut-off", "2025-01-15T23:30:00.000Z", "2025-01-15"],
    ["12:00 Rome", "2025-01-16T11:00:00.000Z", "2025-01-16"],
  ])(
    "%s: business_date_of gets the request instant and the reply carries its date",
    async (_label, instant, businessDate) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(instant));
      as("owner", undefined, ok(businessDate));
      const response = await get("?period=day");
      expect(response.status).toBe(200);
      expect(client.rpc).toHaveBeenCalledWith("business_date_of", { p_at: instant });
      expect(((await response.json()) as { businessDate: string }).businessDate).toBe(businessDate);
    },
  );

  it("a business date that is not an ISO date is a 500 report_unavailable, logged without the value", async () => {
    as("owner", undefined, ok("15/01/2025"));
    const response = await get("?period=day");
    expect(response.status).toBe(500);
    expect(await code(response)).toBe("report_unavailable");
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(String(reportError.mock.calls[0]![0])).not.toContain("15/01/2025");
  });

  it("a failed business_date_of is a 500 report_unavailable logged by code", async () => {
    as("owner", undefined, failure("XX000", "boom"));
    const response = await get("?period=day");
    expect(response.status).toBe(500);
    expect(await code(response)).toBe("report_unavailable");
    expect(String(reportError.mock.calls[0]![0])).toContain("business_date_of failed: XX000");
  });
});
