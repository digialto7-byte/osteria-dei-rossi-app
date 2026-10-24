import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  routeContext,
  type FakeResult,
  type FakeSupabase,
} from "../../../helpers/fake-supabase";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/batches/[id]/split/route");

const BATCH = "ba000000-0000-4000-8000-0000000000b1";
const CHILD = "ba000000-0000-4000-8000-0000000000b2";
const FREEZER = "10000000-0000-4000-8000-0000000000a2";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

const RESULT = {
  batchId: BATCH,
  newBatchId: CHILD,
  lotCode: "261024-RAGUDE-3",
  portions: 4,
  producedAt: "2026-10-23T10:00:00+00:00",
  useBy: "2027-01-21T12:00:00+00:00",
  shelfLifeHours: 2162,
  locationId: FREEZER,
  portionsRemaining: 6,
  state: "open",
};
const BODY = { portions: 4, hoursFromNow: 2160 };

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({ claims: claimsFor(role), rpc: { split_batch: [ok(RESULT)], ...rpc } });
}
beforeEach(() => {
  reportError.mockClear();
  as("chef");
});

const post = (body: unknown = BODY, id: string = BATCH, init?: RequestInit) =>
  route.POST(
    jsonRequest(`http://localhost:3000/api/batches/${id}/split`, body, init),
    routeContext({ id }),
  );

describe("POST /api/batches/:id/split", () => {
  it("owner, admin and chef get 201 with the result (AT1)", async () => {
    for (const role of ["owner", "admin", "chef"]) {
      as(role);
      const response = await post();
      expect(response.status, role).toBe(201);
      expect(await response.json()).toEqual(RESULT);
    }
  });

  it("calls split_batch once, with a null location when none is given (SQL keeps the parent's)", async () => {
    await post(BODY);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("split_batch", {
      p_batch: BATCH,
      p_portions: 4,
      p_hours_from_now: 2160,
      p_location: null,
    });
  });

  it("passes the chosen location", async () => {
    await post({ ...BODY, locationId: FREEZER });
    expect(client.rpc).toHaveBeenCalledWith("split_batch", {
      p_batch: BATCH,
      p_portions: 4,
      p_hours_from_now: 2160,
      p_location: FREEZER,
    });
  });

  it("the waiter gets 403 before any RPC, and no session is 401", async () => {
    as("waiter");
    expect((await post()).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
    client = fakeSupabase({ claims: null });
    expect((await post()).status).toBe(401);
  });

  it("a malformed id is a 404 without an RPC", async () => {
    expect((await post(BODY, "nope")).status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("text/plain is a 415, a body over 2 KiB a 413, a bad body a 400; none reaches the RPC", async () => {
    expect((await post("x", BATCH, { headers: { "content-type": "text/plain" } })).status).toBe(
      415,
    );
    expect(
      (
        await post(BODY, BATCH, {
          headers: { "content-type": "application/json", "content-length": "2049" },
        })
      ).status,
    ).toBe(413);
    for (const bad of [
      { ...BODY, unit_cost: 1 },
      { portions: 1.5, hoursFromNow: 24 },
      { portions: 4, hoursFromNow: 8761 },
      { portions: 4 },
      { portions: 4, hoursFromNow: 24, locationId: "nope" },
    ]) {
      expect((await post(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("portions_insufficient, batch_expired and lot_code_conflict are 409", async () => {
    for (const [code, error] of [
      ["portions_insufficient", failure("P0001", "portions_insufficient")],
      ["batch_expired", failure("P0001", "batch_expired")],
      ["lot_code_conflict", failure("23505", 'violates unique constraint "batch_lot_code_uq"')],
    ] as const) {
      as("chef", { split_batch: [error] });
      const response = await post();
      expect(response.status, code).toBe(409);
      expect((await response.json()).error.code).toBe(code);
    }
  });

  it("portions_invalid, shelf_life_invalid and the location codes are 422", async () => {
    for (const code of [
      "portions_invalid",
      "shelf_life_invalid",
      "location_not_found",
      "location_required",
      "no_location",
    ]) {
      as("chef", { split_batch: [failure("P0001", code)] });
      const response = await post();
      expect(response.status, code).toBe(422);
      expect((await response.json()).error.code).toBe(code);
    }
  });

  it("an unknown batch is a 404", async () => {
    as("chef", { split_batch: [failure("P0002", "batch_not_found")] });
    expect((await post()).status).toBe(404);
  });

  it("an injected total_cost in the reply does not reach the JSON (the answer is built field by field)", async () => {
    as("chef", { split_batch: [ok({ ...RESULT, total_cost: 8 })] });
    const response = await post();
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(RESULT);
  });
});
