import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimsFor,
  fakeSupabase,
  type FakeResult,
  type FakeSupabase,
} from "../../../helpers/fake-supabase";

let client: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const route = await import("@/app/api/batches/proposal/route");

const BASE = "http://localhost:3000/api/batches/proposal";
const KEY = "ec000000-0000-4000-8000-0000000000e1";
const RECIPE = "ed000000-0000-4000-8000-0000000000d1";
const BEEF = "1a000000-0000-4000-8000-00000000001a";
const CELLA = "10000000-0000-4000-8000-0000000000a1";
const LOT = "10700000-0000-4000-8000-0000000000a1";

const ok = (data: unknown): FakeResult => ({ data, error: null });
const failure = (code: string, message: string): FakeResult => ({
  data: null,
  error: { code, message },
});

// What public.batch_proposal returns (AT2: 6,2 kg of stew), plus a tempting extra column that must never get out.
const PROPOSAL = {
  recipe: {
    key: KEY,
    id: RECIPE,
    version: 1,
    name: "Spezzatino (demo)",
    outputQty: 6,
    outputUnit: "kg",
    portionsPerBatch: 30,
    shelfLifeHours: 72,
    portionSize: 0.2,
  },
  outputQty: 6.2,
  portionsComputed: 31,
  shelfLifeHours: 72,
  useByPreview: "2026-10-26T10:00:00+00:00",
  today: "2026-10-23",
  locations: [{ id: CELLA, name: "Cella (demo)" }],
  suggestedLocationId: CELLA,
  inputs: [
    {
      ingredientId: BEEF,
      name: "Manzo muscolo (demo)",
      baseUnit: "kg",
      isStock: true,
      proposedQty: 5.1667,
      units: ["kg", "g"],
      suggestedLocationId: CELLA,
      onHand: [{ locationId: CELLA, onHandQty: 6 }],
      lots: [
        {
          rawLotId: LOT,
          lotCode: "L-D2",
          locationId: CELLA,
          expiry: "2026-10-25",
          expiryState: "ok",
          onHandQty: 3,
          fefoRank: 1,
        },
      ],
    },
  ],
};

function as(role: string, rpc: Record<string, FakeResult[]> = {}) {
  client = fakeSupabase({
    claims: claimsFor(role),
    rpc: { batch_proposal: [ok(PROPOSAL)], ...rpc },
  });
}
beforeEach(() => {
  reportError.mockClear();
  as("owner");
});

const get = (query = `?recipeKey=${KEY}`) => route.GET(new Request(`${BASE}${query}`));

describe("GET /api/batches/proposal", () => {
  it("owner, admin and chef get 200", async () => {
    for (const role of ["owner", "admin", "chef"]) {
      as(role);
      expect((await get()).status, role).toBe(200);
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

  it("calls batch_proposal once with the planned arguments and passes the AT2 values through", async () => {
    const response = await get(`?recipeKey=${KEY}&outputQty=6.2`);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("batch_proposal", {
      p_recipe_key: KEY,
      p_output_qty: 6.2,
      p_shelf_life_hours: null,
    });
    const body = await response.json();
    expect(body.inputs[0].proposedQty).toBe(5.1667);
    expect(body.portionsComputed).toBe(31);
    expect(body).toEqual(PROPOSAL);
  });

  it("passes the shelf life and defaults the rest to null", async () => {
    await get(`?recipeKey=${KEY}&shelfLifeHours=48`);
    expect(client.rpc).toHaveBeenCalledWith("batch_proposal", {
      p_recipe_key: KEY,
      p_output_qty: null,
      p_shelf_life_hours: 48,
    });
  });

  it("an unknown parameter, a missing key or a bad number is a 400 without an RPC", async () => {
    for (const query of [
      `?recipeKey=${KEY}&unit_cost=1`,
      "",
      `?recipeKey=${KEY}&outputQty=abc`,
      `?recipeKey=${KEY}&outputQty=1.23456`,
    ]) {
      as("chef");
      expect((await get(query)).status, query).toBe(400);
      expect(client.rpc).not.toHaveBeenCalled();
    }
  });

  it("drops an extra field the RPC reply carries, such as a unit cost", async () => {
    const lot = PROPOSAL.inputs[0]!.lots[0]!;
    const leaky = {
      ...PROPOSAL,
      unit_cost: 10,
      inputs: [{ ...PROPOSAL.inputs[0], unit_cost: 10, lots: [{ ...lot, unit_cost: 10 }] }],
    };
    as("chef", { batch_proposal: [ok(leaky)] });
    const response = await get();
    // The answer is built field by field, so the injected column never reaches the JSON.
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("unit_cost");
  });

  it("carries no key that looks like money and no euro sign", async () => {
    const text = await (await get()).text();
    const keys = [...text.matchAll(/"([A-Za-z_]+)":/g)].map((m) => m[1]!);
    expect(keys.filter((k) => /eur|cost|price|margin|value|amount/i.test(k))).toEqual([]);
    expect(text).not.toContain("€");
  });

  it.each([
    ["P0002", "recipe_not_found", 404],
    ["P0001", "recipe_not_batch", 422],
    ["P0001", "recipe_inactive", 422],
    ["P0001", "recipe_not_producible", 422],
    ["P0001", "output_invalid", 422],
    ["P0001", "shelf_life_invalid", 422],
    ["42501", "permission denied", 403],
  ])("%s %s becomes %i", async (code, message, status) => {
    as("chef", { batch_proposal: [failure(code, message)] });
    const response = await get();
    expect(response.status).toBe(status);
    expect((await response.json()).error.message).not.toContain(message);
  });

  it("an unexpected database error is a 500 that reports the SQLSTATE only", async () => {
    as("chef", { batch_proposal: [failure("XX000", "boom SEGRETO 12 kg")] });
    const response = await get();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("SEGRETO");
    expect(String(reportError.mock.calls[0]?.[0])).toContain("XX000");
  });
});
