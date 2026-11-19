import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  type FakeResult,
  type FakeSupabase,
} from "../../helpers/fake-supabase";

// Opening stock step 15: GET /api/stock/opening/history?locationId= (plan 2026-11-18 §3.5). Owner and admin only.
let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/observability/report", () => ({ reportError: () => undefined }));

const historyRoute = await import("@/app/api/stock/opening/history/route");

const LOC = "10000000-0000-4000-8000-0000000000a1";
const HISTORY = {
  location: { id: LOC, name: "Dispensa (demo)" },
  countedOn: null,
  countOpen: false,
  operations: [
    {
      openingId: "0e000000-0000-4000-8000-000000000001",
      effectiveOn: "2026-12-01",
      createdAt: "2026-12-01T10:00:00+00:00",
      byName: "Titolare Demo",
      lineCount: 1,
      totalValueEur: 20,
      reversed: { at: "2026-12-02T10:00:00+00:00", byName: "Admin Demo", reasonCode: "qty_wrong" },
      correctable: false,
      lines: [
        {
          movementId: "0a000000-0000-4000-8000-000000000001",
          ingredientId: "1a000000-0000-4000-8000-000000000001",
          name: "Farina 00 (demo)",
          baseUnit: "kg",
          qty: 25,
          unitCostEur: 0.8,
          valueEur: 20,
        },
      ],
    },
  ],
};
const ok = (data: unknown): FakeResult => ({ data, error: null });
function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({
    claims: claimsFor(role),
    rpc: { opening_history: [ok(HISTORY)], ...rpc },
  });
}
beforeEach(() => as("owner"));
const get = (query = `?locationId=${LOC}`) =>
  historyRoute.GET(new Request(`http://localhost:3000/api/stock/opening/history${query}`));

describe("GET /api/stock/opening/history", () => {
  it("calls opening_history with the location and answers the history", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(HISTORY);
    expect(client.rpc).toHaveBeenCalledWith("opening_history", { p_location: LOC });
  });

  it("without locationId, or with a bad one, is a 400 with no RPC", async () => {
    for (const q of ["", "?locationId=x"]) {
      as("owner");
      expect((await get(q)).status, q).toBe(400);
      expect(client.rpc).not.toHaveBeenCalled();
    }
  });

  it("chef and waiter get 403 with no RPC; the admin reads it", async () => {
    for (const role of ["chef", "waiter"]) {
      as(role);
      expect((await get()).status, role).toBe(403);
      expect(client.rpc).not.toHaveBeenCalled();
    }
    as("admin");
    expect((await get()).status).toBe(200);
  });

  it("location_not_found (another tenant's location) is a 422", async () => {
    as("owner", {
      opening_history: [{ data: null, error: { code: "P0001", message: "location_not_found" } }],
    });
    expect((await get()).status).toBe(422);
  });
});
