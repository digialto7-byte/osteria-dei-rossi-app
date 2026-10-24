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

const route = await import("@/app/api/batches/[id]/discard/route");

const BATCH = "ba000000-0000-4000-8000-0000000000b1";
const MOVE = "0e000000-0000-4000-8000-0000000000e1";
const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

const RESULT = {
  batchId: BATCH,
  movementId: MOVE,
  portions: 3,
  reasonCode: "spoilage",
  portionsRemaining: 7,
  state: "open",
};
const BODY = { portions: 3, reason: "spoilage" };

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({ claims: claimsFor(role), rpc: { discard_batch: [ok(RESULT)], ...rpc } });
}
beforeEach(() => {
  reportError.mockClear();
  as("chef");
});

const post = (body: unknown = BODY, id: string = BATCH, init?: RequestInit) =>
  route.POST(
    jsonRequest(`http://localhost:3000/api/batches/${id}/discard`, body, init),
    routeContext({ id }),
  );

describe("POST /api/batches/:id/discard", () => {
  it("owner, admin and chef get 201 with the result (AT2)", async () => {
    for (const role of ["owner", "admin", "chef"]) {
      as(role);
      const response = await post();
      expect(response.status, role).toBe(201);
      expect(await response.json()).toEqual(RESULT);
    }
  });

  it("calls discard_batch once with the exact arguments", async () => {
    await post(BODY);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("discard_batch", {
      p_batch: BATCH,
      p_portions: 3,
      p_reason: "spoilage",
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
      { portions: 0, reason: "spoilage" },
      { portions: 3, reason: "count_correction" },
      { portions: 3, reason: "foo" },
      { portions: 3 },
    ]) {
      expect((await post(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("portions_insufficient is a 409; reason_invalid and portions_invalid are 422", async () => {
    as("chef", { discard_batch: [failure("P0001", "portions_insufficient")] });
    const insufficient = await post();
    expect(insufficient.status).toBe(409);
    expect((await insufficient.json()).error.code).toBe("portions_insufficient");
    for (const code of ["reason_invalid", "portions_invalid"]) {
      as("chef", { discard_batch: [failure("P0001", code)] });
      const response = await post();
      expect(response.status, code).toBe(422);
      expect((await response.json()).error.code).toBe(code);
    }
  });

  it("an unknown batch is a 404, an unexpected error a 500 without the database text", async () => {
    as("chef", { discard_batch: [failure("P0002", "batch_not_found")] });
    expect((await post()).status).toBe(404);
    as("chef", { discard_batch: [failure("XX000", "boom SEGRETO")] });
    const response = await post();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("SEGRETO");
  });

  it("an injected unit_cost in the reply does not reach the JSON (the answer is built field by field)", async () => {
    as("chef", { discard_batch: [ok({ ...RESULT, unit_cost: 2, value_eur: 6 })] });
    const response = await post();
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(RESULT);
  });
});
