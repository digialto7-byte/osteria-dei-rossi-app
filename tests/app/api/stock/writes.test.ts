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

const wasteRoute = await import("@/app/api/stock/waste/route");
const transferRoute = await import("@/app/api/stock/transfers/route");
const reverseRoute = await import("@/app/api/stock/movements/[id]/reverse/route");

const BASE = "http://localhost:3000/api/stock";
const ING = "1a000000-0000-4000-8000-00000000001a";
const CELLA = "10000000-0000-4000-8000-0000000000a1";
const FREEZER = "10000000-0000-4000-8000-0000000000a2";
const LOT = "10700000-0000-4000-8000-0000000000a1";
const MOVE = "0e000000-0000-4000-8000-0000000000e1";
const MOVE2 = "0e000000-0000-4000-8000-0000000000e2";
const OP = "0f000000-0000-4000-8000-0000000000a1";
const OP2 = "0f000000-0000-4000-8000-0000000000a2";

const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

const WASTE_RESULT = {
  operationId: OP,
  movements: [{ id: MOVE, rawLotId: LOT, locationId: CELLA, qty: -1.5 }],
  onHandQty: 0.5,
  negative: false,
};
const TRANSFER_RESULT = {
  operationId: OP,
  movements: [
    { id: MOVE, rawLotId: LOT, locationId: CELLA, qty: -1.5 },
    { id: MOVE2, rawLotId: LOT, locationId: FREEZER, qty: 1.5 },
  ],
  fromOnHandQty: 0.5,
  toOnHandQty: 1.5,
};
const REVERSE_RESULT = {
  operationId: OP2,
  reversedOperationId: OP,
  movements: [{ id: MOVE2, rawLotId: LOT, locationId: CELLA, qty: 1.5 }],
};

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({
    claims: claimsFor(role),
    rpc: {
      post_waste: [ok(WASTE_RESULT)],
      post_transfer: [ok(TRANSFER_RESULT)],
      reverse_movement: [ok(REVERSE_RESULT)],
      ...rpc,
    },
  });
}
beforeEach(() => {
  reportError.mockClear();
  as("owner");
});

const wasteBody = { ingredientId: ING, qty: 1.5, unit: "kg", reason: "spoilage" };
const transferBody = {
  ingredientId: ING,
  qty: 1.5,
  unit: "kg",
  fromLocationId: CELLA,
  toLocationId: FREEZER,
};
const postWaste = (body: unknown = wasteBody, init?: RequestInit) =>
  wasteRoute.POST(jsonRequest(`${BASE}/waste`, body, init));
const postTransfer = (body: unknown = transferBody, init?: RequestInit) =>
  transferRoute.POST(jsonRequest(`${BASE}/transfers`, body, init));
const postReverse = (id = MOVE, body: unknown = {}, init?: RequestInit) =>
  reverseRoute.POST(
    jsonRequest(`${BASE}/movements/${id}/reverse`, body, init),
    routeContext({ id }),
  );

const calls: [string, () => Promise<Response>][] = [
  ["POST /api/stock/waste", () => postWaste()],
  ["POST /api/stock/transfers", () => postTransfer()],
  ["POST /api/stock/movements/:id/reverse", () => postReverse()],
];

describe("role table", () => {
  it.each(calls)("%s: owner, admin and chef get 201", async (_name, call) => {
    for (const role of ["owner", "admin", "chef"]) {
      as(role);
      expect((await call()).status, role).toBe(201);
    }
  });

  it.each(calls)("%s: the waiter gets 403 before any RPC", async (_name, call) => {
    as("waiter");
    expect((await call()).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each(calls)("%s: no session is 401", async (_name, call) => {
    client = fakeSupabase({ claims: null });
    expect((await call()).status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("text/plain is a 415 on every write", async () => {
    const plain = { headers: { "content-type": "text/plain" } };
    expect((await postWaste("x", plain)).status).toBe(415);
    expect((await postTransfer("x", plain)).status).toBe(415);
    expect((await postReverse(MOVE, "x", plain)).status).toBe(415);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe("POST /api/stock/waste", () => {
  it("calls post_waste once with the planned arguments", async () => {
    const response = await postWaste();
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(WASTE_RESULT);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("post_waste", {
      p_ingredient: ING,
      p_qty: 1.5,
      p_unit: "kg",
      p_reason: "spoilage",
      p_location: null,
      p_lot: null,
    });
  });

  it("passes the location and the lot, and the typed unit as typed", async () => {
    await postWaste({ ...wasteBody, qty: 500, unit: "g", locationId: CELLA, lotId: LOT });
    expect(client.rpc).toHaveBeenCalledWith("post_waste", {
      p_ingredient: ING,
      p_qty: 500,
      p_unit: "g",
      p_reason: "spoilage",
      p_location: CELLA,
      p_lot: LOT,
    });
  });

  it("an extra key, a bad reason and a bad quantity are 400s without an RPC", async () => {
    for (const body of [
      { ...wasteBody, unit_cost: 1 },
      { ...wasteBody, reason: "foo" },
      { ...wasteBody, qty: 0 },
      { ...wasteBody, qty: 1.23456 },
    ]) {
      as("chef");
      expect((await postWaste(body)).status).toBe(400);
      expect(client.rpc).not.toHaveBeenCalled();
    }
  });

  it("reports negative stock to the caller", async () => {
    as("chef", { post_waste: [ok({ ...WASTE_RESULT, onHandQty: -1, negative: true })] });
    const body = await (await postWaste()).json();
    expect([body.onHandQty, body.negative]).toEqual([-1, true]);
  });

  it.each([
    ["P0001", "lot_empty", 409],
    ["P0001", "reason_invalid", 422],
    ["P0001", "unit_mismatch", 422],
    ["P0001", "qty_invalid", 422],
    ["P0001", "ingredient_not_stock", 422],
    ["P0001", "location_required", 422],
    ["P0001", "no_location", 422],
    ["P0001", "location_not_found", 422],
    ["P0002", "ingredient_not_found", 404],
    ["P0002", "lot_not_found", 404],
    ["42501", "permission denied", 403],
  ])("%s %s becomes %i", async (code, message, status) => {
    as("chef", { post_waste: [failure(code, message)] });
    const response = await postWaste();
    expect(response.status).toBe(status);
    expect((await response.json()).error.message).not.toContain(message);
  });

  it("an unexpected database error is a 500 that reports the SQLSTATE only", async () => {
    as("chef", { post_waste: [failure("XX000", "boom SEGRETO 12 kg")] });
    const response = await postWaste();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("SEGRETO");
    expect(String(reportError.mock.calls[0]?.[0])).toContain("XX000");
    expect(String(reportError.mock.calls[0]?.[0])).not.toContain("SEGRETO");
  });
});

describe("POST /api/stock/transfers", () => {
  it("calls post_transfer with both locations", async () => {
    const response = await postTransfer();
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(TRANSFER_RESULT);
    expect(client.rpc).toHaveBeenCalledWith("post_transfer", {
      p_ingredient: ING,
      p_qty: 1.5,
      p_unit: "kg",
      p_from: CELLA,
      p_to: FREEZER,
      p_lot: null,
    });
  });

  it("passes the lot", async () => {
    await postTransfer({ ...transferBody, lotId: LOT });
    expect(client.rpc).toHaveBeenCalledWith(
      "post_transfer",
      expect.objectContaining({ p_lot: LOT }),
    );
  });

  it("needs both locations and refuses extra keys", async () => {
    for (const body of [
      { ...transferBody, toLocationId: undefined },
      { ...transferBody, reason: "spoilage" },
    ]) {
      expect((await postTransfer(body)).status).toBe(400);
    }
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["P0001", "insufficient_stock", 409],
    ["P0001", "lot_empty", 409],
    ["P0001", "same_location", 422],
    ["P0001", "unit_mismatch", 422],
    ["P0002", "lot_not_found", 404],
  ])("%s %s becomes %i", async (code, message, status) => {
    as("chef", { post_transfer: [failure(code, message)] });
    expect((await postTransfer()).status).toBe(status);
  });
});

describe("POST /api/stock/movements/:id/reverse", () => {
  it("calls reverse_movement with the path id", async () => {
    const response = await postReverse();
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(REVERSE_RESULT);
    expect(client.rpc).toHaveBeenCalledWith("reverse_movement", { p_movement: MOVE });
  });

  it("a malformed path id is a 404 without any RPC", async () => {
    const response = await postReverse("x");
    expect(response.status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("the body is an empty strict object", async () => {
    expect((await postReverse(MOVE, { reason: "x" })).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["P0001", "already_reversed", 409],
    ["P0001", "movement_is_reversal", 409],
    ["P0001", "movement_not_reversible", 409],
    ["P0001", "transfer_already_used", 409],
    ["P0002", "movement_not_found", 404],
  ])("%s %s becomes %i", async (code, message, status) => {
    as("chef", { reverse_movement: [failure(code, message)] });
    const response = await postReverse();
    expect(response.status).toBe(status);
    if (status === 409) expect((await response.json()).error.code).toBe(message);
  });

  it("the unique index backstop (23505 on stock_movement_reverses_uq) is a 409 already_reversed", async () => {
    as("chef", {
      reverse_movement: [
        failure(
          "23505",
          'duplicate key value violates unique constraint "stock_movement_reverses_uq"',
        ),
      ],
    });
    const response = await postReverse();
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("already_reversed");
  });
});

describe("V6: the write answers carry no cost (Q16)", () => {
  const COSTLY = /eur|cost|price|margin|value|amount/i;
  const keysOf = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.flatMap(keysOf)
      : value !== null && typeof value === "object"
        ? Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)])
        : [];

  it("a cost that slips into an RPC reply is dropped, never sent", async () => {
    const leaky = {
      ...WASTE_RESULT,
      unit_cost: 10,
      valueEur: 15,
      movements: [{ ...WASTE_RESULT.movements[0], unit_cost: 10 }],
    };
    as("chef", {
      post_waste: [ok(leaky)],
      post_transfer: [ok({ ...TRANSFER_RESULT, unit_cost: 1 })],
      reverse_movement: [ok({ ...REVERSE_RESULT, unit_cost: 1 })],
    });
    for (const call of [() => postWaste(), () => postTransfer(), () => postReverse()]) {
      const text = await (await call()).text();
      expect(keysOf(JSON.parse(text) as unknown).filter((key) => COSTLY.test(key))).toEqual([]);
      expect(text).not.toContain("€");
      expect(text).not.toContain("unit_cost");
    }
  });
});
