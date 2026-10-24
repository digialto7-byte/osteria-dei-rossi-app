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

const route = await import("@/app/api/batches/[id]/adjust/route");

const BATCH = "ba000000-0000-4000-8000-0000000000b1";
const MOVE = "0e000000-0000-4000-8000-0000000000e1";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

const RESULT = { batchId: BATCH, movementId: MOVE, delta: -1, portionsRemaining: 5, state: "open" };

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({ claims: claimsFor(role), rpc: { adjust_batch: [ok(RESULT)], ...rpc } });
}
beforeEach(() => {
  reportError.mockClear();
  as("chef");
});

const post = (body: unknown = { counted: 5 }, id: string = BATCH, init?: RequestInit) =>
  route.POST(
    jsonRequest(`http://localhost:3000/api/batches/${id}/adjust`, body, init),
    routeContext({ id }),
  );

describe("POST /api/batches/:id/adjust", () => {
  it("owner, admin and chef get 200 with the result (AT3)", async () => {
    for (const role of ["owner", "admin", "chef"]) {
      as(role);
      const response = await post();
      expect(response.status, role).toBe(200);
      expect(await response.json()).toEqual(RESULT);
    }
  });

  it("calls adjust_batch once with the exact arguments", async () => {
    await post({ counted: 5 });
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("adjust_batch", { p_batch: BATCH, p_counted: 5 });
  });

  it("counting 0 is allowed, and an unchanged count has no movement", async () => {
    as("chef", {
      adjust_batch: [
        ok({ ...RESULT, movementId: null, delta: 0, portionsRemaining: 0, state: "finished" }),
      ],
    });
    const response = await post({ counted: 0 });
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith("adjust_batch", { p_batch: BATCH, p_counted: 0 });
    expect((await response.json()).movementId).toBeNull();
  });

  it("the waiter gets 403 before any RPC, and no session is 401", async () => {
    as("waiter");
    expect((await post()).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
    client = fakeSupabase({ claims: null });
    expect((await post()).status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("a malformed id is a 404 without an RPC", async () => {
    expect((await post({ counted: 5 }, "nope")).status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("text/plain is a 415, a body over 2 KiB a 413, an extra key or a bad count a 400; none reaches the RPC", async () => {
    expect((await post("x", BATCH, { headers: { "content-type": "text/plain" } })).status).toBe(
      415,
    );
    expect(
      (
        await post({ counted: 5 }, BATCH, {
          headers: { "content-type": "application/json", "content-length": "2049" },
        })
      ).status,
    ).toBe(413);
    for (const bad of [{ counted: 5, unit_cost: 1 }, { counted: -1 }, { counted: 1.23456 }, {}]) {
      expect((await post(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("count_invalid from the database is a 422, an unknown batch a 404", async () => {
    as("chef", { adjust_batch: [failure("P0001", "count_invalid")] });
    const invalid = await post();
    expect(invalid.status).toBe(422);
    expect((await invalid.json()).error.code).toBe("count_invalid");
    as("chef", { adjust_batch: [failure("P0002", "batch_not_found")] });
    expect((await post()).status).toBe(404);
  });

  it("42501 from the database is a 403 (a stale token)", async () => {
    as("chef", { adjust_batch: [failure("42501", "permission denied")] });
    expect((await post()).status).toBe(403);
  });

  it("an injected unit_cost in the reply does not reach the JSON (the answer is built field by field)", async () => {
    as("chef", { adjust_batch: [ok({ ...RESULT, unit_cost: 2 })] });
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(RESULT);
  });
});
