import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  routeContext,
  type FakeResult,
  type FakeSupabase,
} from "../../../helpers/fake-supabase";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/batches/[id]/route");

const BATCH = "ba000000-0000-4000-8000-0000000000b1";
const CHILD = "ba000000-0000-4000-8000-0000000000b2";
const KEY = "ec000000-0000-4000-8000-0000000000e1";
const CELLA = "10000000-0000-4000-8000-0000000000a1";
const MOVE = "0e000000-0000-4000-8000-0000000000e1";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

const DETAIL = {
  batchId: BATCH,
  lotCode: "261023-RAGUDE-2",
  recipeKey: KEY,
  recipeName: "Ragù (demo)",
  version: 1,
  producedAt: "2026-10-23T10:00:00+00:00",
  useBy: "2026-10-25T10:00:00+00:00",
  useByState: "ok",
  shelfLifeHours: 48,
  outputQty: 2,
  outputUnit: "kg",
  portionsComputed: 10,
  portionsInitial: 10,
  portionsRemaining: 6,
  state: "open",
  locationId: CELLA,
  locationName: "Cella (demo)",
  byInitials: "CD",
  byMe: true,
  createdByInitials: "CD",
  createdAt: "2026-10-23T10:01:00+00:00",
  splitFrom: null,
  splits: [
    { batchId: CHILD, lotCode: "261024-RAGUDE-3", portions: 4, locationName: "Congelatore (demo)" },
  ],
  movements: [
    {
      id: MOVE,
      type: "split",
      portions: -4,
      reasonCode: null,
      refType: "batch_split",
      at: "2026-10-24T10:10:00+00:00",
      byInitials: "CD",
      byMe: true,
    },
  ],
  defaults: { hoursLeft: 24 },
  can: { adjust: true, discard: true, split: true },
};

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({ claims: claimsFor(role), rpc: { batch_detail: [ok(DETAIL)], ...rpc } });
}
beforeEach(() => {
  reportError.mockClear();
  as("chef");
});

const get = (id: string = BATCH) =>
  route.GET(new Request(`http://localhost:3000/api/batches/${id}`), routeContext({ id }));

describe("GET /api/batches/:id", () => {
  it("owner, admin and chef get the detail, with one RPC", async () => {
    for (const role of ["owner", "admin", "chef"]) {
      as(role);
      const response = await get();
      expect(response.status, role).toBe(200);
      expect(await response.json()).toEqual(DETAIL);
      expect(client.rpc).toHaveBeenCalledTimes(1);
      expect(client.rpc).toHaveBeenCalledWith("batch_detail", { p_batch: BATCH });
    }
  });

  it("the waiter gets 403 before any RPC, and no session is 401", async () => {
    as("waiter");
    expect((await get()).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
    client = fakeSupabase({ claims: null });
    expect((await get()).status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("a malformed id is a 404 without an RPC", async () => {
    expect((await get("nope")).status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("an unknown or foreign batch (P0002) is a 404", async () => {
    as("chef", { batch_detail: [failure("P0002", "batch_not_found")] });
    const response = await get();
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("not_found");
  });

  it("drops a cost the reply carries, at the top level and inside a movement", async () => {
    as("chef", {
      batch_detail: [
        ok({
          ...DETAIL,
          unit_cost: 2,
          movements: [{ ...DETAIL.movements[0], unit_cost: 2 }],
        }),
      ],
    });
    const response = await get();
    // The service builds the answer field by field: an undeclared key is dropped, never a leak.
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(DETAIL);
  });

  it("an unexpected database error is a 500 that reports the SQLSTATE only", async () => {
    as("chef", { batch_detail: [failure("XX000", "boom SEGRETO")] });
    const response = await get();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("SEGRETO");
  });
});
