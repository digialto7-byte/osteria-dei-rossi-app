import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  type FakeResult,
  type FakeSupabase,
} from "../../../helpers/fake-supabase";
import { dbError, ok } from "../../../helpers/review-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const route = await import("@/app/api/reports/extraction-quality/route");

const BASE = "http://localhost:3000/api/reports/extraction-quality";
const SUPPLIER = "5a000000-0000-4000-8000-000000000001";

/** The 10-line fixture of AT5: one corrected line. */
const REPORT = {
  invoices: 2,
  lines: 10,
  correctedLines: 1,
  correctionRate: 0.1,
  autoMappedLines: 10,
  autoMappedCorrected: 1,
  autoMappedCorrectionRate: 0.1,
  manualMappedLines: 0,
  splitLines: 0,
  byField: { qty: 1 },
  bySupplier: [
    {
      supplierId: SUPPLIER,
      name: "Fornitore Demo Srl",
      lines: 10,
      correctedLines: 1,
      correctionRate: 0.1,
    },
  ],
};

function as(role: string, result: FakeResult = ok(REPORT)) {
  client = fakeSupabase({
    claims: role === "none" ? null : claimsFor(role),
    rpc: { extraction_quality: [result] },
  });
}
const get = (query = "") => route.GET(new Request(`${BASE}${query}`));
const lastArgs = () => client.rpc.mock.calls.at(-1)![1];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-25T23:30:00Z"));
  as("owner");
});
afterEach(() => vi.useRealTimers());

describe("GET /api/reports/extraction-quality", () => {
  it("defaults to the last 30 days ending today in Europe/Rome", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    // 23:30 UTC on 25 October is already 26 October in Rome (CET).
    expect(client.rpc).toHaveBeenCalledWith("extraction_quality", {
      p_from: "2026-09-27",
      p_to: "2026-10-26",
      p_supplier: null,
      p_status: "all",
    });
    expect((await response.json()).period).toEqual({ from: "2026-09-27", to: "2026-10-26" });
  });

  it("still ends on the 25th half an hour earlier", async () => {
    vi.setSystemTime(new Date("2026-10-25T22:30:00Z"));
    await get();
    expect(lastArgs()).toMatchObject({ p_to: "2026-10-25", p_from: "2026-09-26" });
  });

  it("passes the RPC result through in camelCase (AT5)", async () => {
    const { report } = await (await get()).json();
    expect(report).toEqual(REPORT);
    expect(report.correctionRate).toBe(0.1);
    expect(report.correctedLines).toBe(1);
  });

  it("passes explicit bounds, supplier and status", async () => {
    await get(`?from=2026-01-01&to=2026-03-31&supplierId=${SUPPLIER}&status=approved`);
    expect(lastArgs()).toEqual({
      p_from: "2026-01-01",
      p_to: "2026-03-31",
      p_supplier: SUPPLIER,
      p_status: "approved",
    });
  });

  it("derives the missing bound from the one given", async () => {
    await get("?to=2026-03-31");
    expect(lastArgs()).toMatchObject({ p_from: "2026-03-02", p_to: "2026-03-31" });
    await get("?from=2026-10-01");
    expect(lastArgs()).toMatchObject({ p_from: "2026-10-01", p_to: "2026-10-26" });
  });

  it("accepts a range of 366 days", async () => {
    expect((await get("?from=2026-01-01&to=2027-01-01")).status).toBe(200);
  });

  it.each([
    ["a from after the to", "?from=2026-10-02&to=2026-10-01"],
    ["a 367-day range", "?from=2026-01-01&to=2027-01-02"],
    ["a bad status", "?status=foo"],
    ["an empty status", "?status="],
    ["a bad date", "?from=yesterday"],
    ["a date with a time", "?to=2026-10-01T10:00:00Z"],
    ["an impossible date", "?from=2026-02-30"],
    ["a bad supplier id", "?supplierId=x"],
    ["a from after today with no to", "?from=2026-11-01"],
  ])("answers 400 for %s without calling the database", async (_name, query) => {
    const response = await get(query);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_request");
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("maps a database range_too_long to 400", async () => {
    as("owner", dbError("P0001", "range_too_long"));
    const response = await get();
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_request");
  });

  it("answers 500 without details on an unexpected error", async () => {
    as("owner", dbError("XX000", "internal secret"));
    const response = await get();
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret");
  });

  it("works for an admin", async () => {
    as("admin");
    expect((await get()).status).toBe(200);
  });

  it.each(["chef", "waiter"])("answers 403 for a %s before any call", async (role) => {
    as(role);
    expect((await get()).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("answers 401 without a session", async () => {
    as("none");
    expect((await get()).status).toBe(401);
  });

  it("exports only GET", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(route).not.toHaveProperty(method);
    }
  });
});
