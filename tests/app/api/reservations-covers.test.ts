import { beforeEach, describe, expect, it, vi } from "vitest";
import { reportError } from "@/lib/observability/report";
import {
  claimsFor,
  fakeSupabase,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

const route = await import("@/app/api/reservations/covers/route");
const BASE = "http://localhost:3000/api/reservations/covers";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

const COVERS = {
  businessDate: "1998-11-13",
  services: [
    { key: "pranzo", name: "Pranzo", reservations: 2, covers: 6 },
    { key: "cena", name: "Cena", reservations: 1, covers: 5 },
  ],
};

function as(role: string, reply: FakeResult = ok(COVERS)) {
  client = fakeSupabase({
    claims: role === "none" ? null : claimsFor(role),
    rpc: { reservations_covers: [reply] },
  });
}
const get = (query = "") =>
  (route.GET as (r: Request) => Promise<Response>)(new Request(`${BASE}${query}`));

beforeEach(() => {
  vi.mocked(reportError).mockClear();
  as("owner");
});

describe("GET /api/reservations/covers", () => {
  it.each(["owner", "admin", "waiter", "chef"])("%s: 200 with the counts only", async (role) => {
    as(role);
    const response = await get("?date=1998-11-13");
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("reservations_covers", { p_date: "1998-11-13" });
    expect(await response.json()).toEqual(COVERS);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("no date: p_date null (the database's business today)", async () => {
    await get();
    expect(client.rpc).toHaveBeenCalledWith("reservations_covers", { p_date: null });
  });

  it("a day with no service bookings parses", async () => {
    as("chef", ok({ businessDate: "1998-11-13", services: [] }));
    expect((await get()).status).toBe(200);
  });

  it.each(["names", "contact", "email", "pendingCovers"])(
    "a service with an extra key %s is a 500 and the value never reaches the body",
    async (key) => {
      const services = [{ ...COVERS.services[0]!, [key]: "Cliente Demo" }];
      as("chef", ok({ ...COVERS, services }));
      const response = await get();
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain("Cliente Demo");
    },
  );

  it("an extra top-level key is a 500", async () => {
    as("chef", ok({ ...COVERS, guests: [] }));
    expect((await get()).status).toBe(500);
  });

  it.each([
    "?date=1998-13-01",
    "?date=13-11-1998",
    "?date=",
    "?foo=1",
    "?date=1998-11-13&date=1998-11-14",
  ])("%s is a 400 with no RPC", async (query) => {
    expect((await get(query)).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("date_out_of_range is a 422; 42501 a 403; no session a 401", async () => {
    as("owner", failure("P0001", "date_out_of_range"));
    const response = await get("?date=2999-01-01");
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "date_out_of_range",
    );
    as("owner", failure("42501", "permission denied"));
    expect((await get()).status).toBe(403);
    as("none");
    expect((await get()).status).toBe(401);
  });

  it("an unexpected database error is a 500 reported by code only", async () => {
    as("owner", failure("XX000", "boom in reservation for Cliente Demo"));
    expect((await get()).status).toBe(500);
    const reported = vi.mocked(reportError).mock.calls.map((c) => String((c[0] as Error).message));
    expect(reported.join()).toContain("XX000");
    expect(reported.join()).not.toMatch(/Cliente Demo|reservation/);
  });
});
