import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";
import { DAY_SERVICES } from "../../helpers/services-data";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/day-close/services/route");
const BASE = "http://localhost:3000/api/day-close/services";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({
    claims: role === "none" ? null : claimsFor(role),
    rpc: { day_services: [ok(DAY_SERVICES)], ...rpc },
  });
}
const get = (query = "") => route.GET(new Request(`${BASE}${query}`));
const errorOf = async (response: Response) =>
  ((await response.json()) as { error: { code: string; message: string } }).error;

const TIMING = /^auth;dur=\d+(\.\d)?, rpc;dur=\d+(\.\d)?, total;dur=\d+(\.\d)?$/;

beforeEach(() => {
  reportError.mockClear();
  as("owner");
});

describe("GET /api/day-close/services", () => {
  it.each(["owner", "admin"])(
    "%s: one RPC with the date, parsed by the output schema",
    async (role) => {
      as(role);
      const response = await get("?date=2026-11-04");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(DAY_SERVICES);
      expect(client.rpc).toHaveBeenCalledTimes(1);
      expect(client.rpc).toHaveBeenCalledWith("day_services", { p_date: "2026-11-04" });
    },
  );

  it("no date goes to the database as null (today's business date)", async () => {
    await get();
    expect(client.rpc).toHaveBeenCalledWith("day_services", { p_date: null });
  });

  it("carries Server-Timing and is never cached", async () => {
    const response = await get();
    expect(response.headers.get("server-timing")).toMatch(TIMING);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each(["chef", "waiter"])("%s gets 403 before any RPC", async (role) => {
    as(role);
    expect((await get()).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("no session is 401", async () => {
    as("none");
    expect((await get()).status).toBe(401);
  });

  it.each(["?date=2026-13-01", "?date=x", "?x=1", "?date=2026-11-04&date=2026-11-05"])(
    "%s is 400 without an RPC",
    async (query) => {
      expect((await get(query)).status).toBe(400);
      expect(client.rpc).not.toHaveBeenCalled();
    },
  );

  it("business_date_invalid is 422 with the day-close sentence", async () => {
    as("owner", { day_services: [failure("P0001", "business_date_invalid")] });
    const response = await get("?date=2026-01-01");
    expect(response.status).toBe(422);
    const error = await errorOf(response);
    expect(error.code).toBe("business_date_invalid");
    expect(error.message).toBe("La data non è valida: puoi scegliere fino a 62 giorni fa.");
  });

  it("an unexpected database error is a 500 that names no message", async () => {
    as("owner", { day_services: [failure("XX000", "secret internals")] });
    const response = await get();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });

  it("a reply carrying a staff name (closedBy) is a 500: no name passes", async () => {
    const withName = structuredClone(DAY_SERVICES);
    Object.assign(withName.sessions[0]!, { closedBy: { id: "x", displayName: "Cameriere Demo" } });
    as("owner", { day_services: [ok(withName)] });
    const response = await get();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("Cameriere");
  });

  it("a reply with an extra key in a service is a 500", async () => {
    const extra = structuredClone(DAY_SERVICES);
    Object.assign(extra.services[0]!, { foodCostEur: 4.2 });
    as("owner", { day_services: [ok(extra)] });
    expect((await get()).status).toBe(500);
  });
});
