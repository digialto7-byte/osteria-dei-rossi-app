import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  jsonRequest,
  type FakeResult,
  type FakeSupabase,
} from "../../../helpers/fake-supabase";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/batches/route");

const URL_ = "http://localhost:3000/api/batches";
const RECIPE = "ed000000-0000-4000-8000-0000000000d1";
const KEY = "ec000000-0000-4000-8000-0000000000e1";
const BATCH = "ba000000-0000-4000-8000-0000000000b1";
const BEEF = "1a000000-0000-4000-8000-00000000001a";
const ONION = "1b000000-0000-4000-8000-00000000001b";
const CARROT = "1c000000-0000-4000-8000-00000000001c";
const CELLA = "10000000-0000-4000-8000-0000000000a1";
const LOT = "10700000-0000-4000-8000-0000000000a1";
const MOVE = "0e000000-0000-4000-8000-0000000000e1";

const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string, details?: string): FakeResult => ({
  data: null,
  error: { code, message, details },
});

const RESULT = {
  batchId: BATCH,
  lotCode: "261023-SPEZZA-1",
  recipe: { key: KEY, id: RECIPE, version: 1, name: "Spezzatino (demo)" },
  producedAt: "2026-10-23T10:00:00+00:00",
  useBy: "2026-10-26T10:00:00+00:00",
  outputQty: 6.2,
  outputUnit: "kg",
  portionsComputed: 31,
  portions: 31,
  shelfLifeHours: 72,
  locationId: CELLA,
  inputs: [
    {
      ingredientId: BEEF,
      locationId: CELLA,
      qty: 5.3,
      movements: [{ id: MOVE, rawLotId: LOT, qty: -3 }],
    },
  ],
  negatives: [],
};

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({ claims: claimsFor(role), rpc: { produce_batch: [ok(RESULT)], ...rpc } });
}
beforeEach(() => {
  reportError.mockClear();
  as("owner");
});

const INPUTS = [
  { ingredientId: BEEF, qty: 5.3, unit: "kg" },
  { ingredientId: ONION, qty: 0.31, unit: "kg" },
  { ingredientId: CARROT, qty: 0.2067, unit: "kg" },
];
const BODY = { recipeId: RECIPE, outputQty: 6.2, inputs: INPUTS };
const post = (body: unknown = BODY, init?: RequestInit) =>
  route.POST(jsonRequest(URL_, body, init));

describe("POST /api/batches", () => {
  it("owner, admin and chef get 201", async () => {
    for (const role of ["owner", "admin", "chef"]) {
      as(role);
      expect((await post()).status, role).toBe(201);
    }
  });

  it("the waiter gets 403 before any RPC, and no session is 401", async () => {
    as("waiter");
    expect((await post()).status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
    client = fakeSupabase({ claims: null });
    expect((await post()).status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("text/plain is a 415, a body over 16 KiB a 413, an extra key a 400; none reaches the RPC", async () => {
    expect((await post("x", { headers: { "content-type": "text/plain" } })).status).toBe(415);
    expect(
      (
        await post(BODY, {
          headers: { "content-type": "application/json", "content-length": "16385" },
        })
      ).status,
    ).toBe(413);
    expect((await post({ ...BODY, unit_cost: 1 })).status).toBe(400);
    expect((await post({ ...BODY, outputQty: 0 })).status).toBe(400);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("calls produce_batch once with the AT1 arguments", async () => {
    const response = await post();
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(RESULT);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("produce_batch", {
      p_recipe_id: RECIPE,
      p_output_qty: 6.2,
      p_inputs: INPUTS,
      p_portions: null,
      p_shelf_life_hours: null,
      p_location: null,
    });
  });

  it("passes the portions, the shelf life, the locations and the lot", async () => {
    await post({
      ...BODY,
      portions: 30,
      shelfLifeHours: 48,
      locationId: CELLA,
      inputs: [{ ingredientId: BEEF, qty: 500, unit: "g", locationId: CELLA, lotId: LOT }],
    });
    expect(client.rpc).toHaveBeenCalledWith("produce_batch", {
      p_recipe_id: RECIPE,
      p_output_qty: 6.2,
      p_inputs: [{ ingredientId: BEEF, qty: 500, unit: "g", locationId: CELLA, lotId: LOT }],
      p_portions: 30,
      p_shelf_life_hours: 48,
      p_location: CELLA,
    });
  });

  it("reports the negative locations of the production to the caller", async () => {
    const negatives = [{ ingredientId: BEEF, locationId: CELLA, onHandQty: -0.3 }];
    as("chef", { produce_batch: [ok({ ...RESULT, negatives })] });
    expect((await (await post()).json()).negatives).toEqual(negatives);
  });

  it("the answer passes the strict schema and carries no cost", async () => {
    const text = await (await post()).text();
    const keys = [...text.matchAll(/"([A-Za-z_]+)":/g)].map((m) => m[1]!);
    expect(keys.filter((k) => /eur|cost|price|margin|value|amount/i.test(k))).toEqual([]);
    expect(text).not.toContain("€");
    // A cost column injected into the RPC reply is dropped by the field-by-field mapping.
    as("chef", { produce_batch: [ok({ ...RESULT, total_cost: 53.5167 })] });
    const leaky = await post();
    expect(leaky.status).toBe(201);
    expect(await leaky.text()).not.toContain("total_cost");
  });

  it.each([
    ["P0001", "recipe_version_stale", 409],
    ["P0001", "lot_empty", 409],
    ["P0001", "inputs_empty", 422],
    ["P0001", "portions_invalid", 422],
    ["P0001", "unit_mismatch", 422],
    ["P0001", "location_required", 422],
    ["P0002", "recipe_not_found", 404],
    ["P0002", "lot_not_found", 404],
    ["P0002", "ingredient_not_found", 404],
    ["42501", "permission denied", 403],
  ])("%s %s becomes %i", async (code, message, status) => {
    as("chef", { produce_batch: [failure(code, message)] });
    const response = await post();
    expect(response.status).toBe(status);
    expect((await response.json()).error.message).not.toContain(message);
  });

  it("input_missing with a detail is a 422 that names the ingredient", async () => {
    as("chef", {
      produce_batch: [
        failure("P0001", "input_missing", JSON.stringify([{ ingredientId: CARROT }])),
      ],
    });
    const response = await post();
    expect(response.status).toBe(422);
    const { error } = await response.json();
    expect(error.code).toBe("input_missing");
    expect(error.details).toEqual([{ ingredientId: CARROT }]);
  });

  it("a duplicate lot code on batch_lot_code_uq is a 409", async () => {
    as("chef", {
      produce_batch: [
        failure("23505", 'duplicate key value violates unique constraint "batch_lot_code_uq"'),
      ],
    });
    const response = await post();
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("lot_code_conflict");
  });

  it("an unexpected database error is a 500 that reports the SQLSTATE only", async () => {
    as("chef", { produce_batch: [failure("XX000", "boom SEGRETO 12 kg")] });
    const response = await post();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("SEGRETO");
    expect(String(reportError.mock.calls[0]?.[0])).toContain("XX000");
    expect(String(reportError.mock.calls[0]?.[0])).not.toContain("SEGRETO");
  });
});
