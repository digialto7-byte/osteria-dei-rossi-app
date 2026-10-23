import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { buildPlateMarginPcts, getPlateMarginPcts } from "@/server/costing/percentages";
import { fakeSupabase, type FakeResult } from "../../helpers/fake-supabase";

const K1 = "cc000000-0000-4000-8000-0000000000c1";
const K2 = "cc000000-0000-4000-8000-0000000000c2";
const ok = (data: unknown): FakeResult => ({ data, error: null });

describe("buildPlateMarginPcts (V6.2)", () => {
  it("builds each item from exactly the allowed keys, sorted by name", () => {
    const items = buildPlateMarginPcts(
      [
        { recipe_key: K2, food_cost_pct: 30, gp_pct: 70, status: "below_target" },
        { recipe_key: K1, food_cost_pct: 18.85, gp_pct: 81.15, status: "ok" },
      ],
      new Map([
        [K1, "Spezzatino con polenta (demo)"],
        [K2, "Arrosto (demo)"],
      ]),
      new Map([
        [K1, 70],
        [K2, 85],
      ]),
    );
    expect(items.map((item) => item.name)).toEqual([
      "Arrosto (demo)",
      "Spezzatino con polenta (demo)",
    ]);
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(
        ["foodCostPct", "gpPct", "name", "recipeKey", "status", "targetGpPct"].sort(),
      );
    }
    expect(items[1]).toEqual({
      recipeKey: K1,
      name: "Spezzatino con polenta (demo)",
      foodCostPct: 18.85,
      gpPct: 81.15,
      targetGpPct: 70,
      status: "ok",
    });
  });

  it("drops any extra column the RPC returns (an injected food_cost never reaches the JSON)", () => {
    const items = buildPlateMarginPcts(
      [
        {
          recipe_key: K1,
          food_cost_pct: 18.85,
          gp_pct: 81.15,
          status: "ok",
          food_cost: 2.0567,
          food_cost_eur: 2.0567,
          sale_price: 12,
        } as never,
      ],
      new Map([[K1, "Piatto (demo)"]]),
      new Map(),
    );
    const json = JSON.stringify(items);
    expect(json).not.toContain("2.0567");
    expect(json).not.toContain("€");
    expect(json).not.toMatch(/"[a-zA-Z_]*(eur|price|margin)"/i);
    expect(Object.keys(items[0]!)).not.toContain("food_cost");
  });

  it("has no key matching the cost pattern and no euro sign", () => {
    const [item] = buildPlateMarginPcts(
      [{ recipe_key: K1, food_cost_pct: 18.85, gp_pct: 81.15, status: "ok" }],
      new Map([[K1, "Piatto (demo)"]]),
      new Map([[K1, 70]]),
    );
    for (const key of Object.keys(item!)) expect(key).not.toMatch(/eur$|cost(?!Pct)|price|margin/i);
    expect(JSON.stringify(item)).not.toContain("€");
  });

  it("fails closed: an unknown status word becomes incomplete, a plate without a name is skipped", () => {
    const items = buildPlateMarginPcts(
      [
        { recipe_key: K1, food_cost_pct: 1, gp_pct: 99, status: "fixed_cost_unallocated" },
        { recipe_key: K2, food_cost_pct: 1, gp_pct: 99, status: "ok" },
      ],
      new Map([[K1, "A (demo)"]]),
      new Map(),
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.status).toBe("incomplete");
    expect(items[0]!.targetGpPct).toBeNull();
  });
});

describe("getPlateMarginPcts", () => {
  it("reads plate_margins_pct, then names and targets with the caller's own session", async () => {
    const client = fakeSupabase({
      rpc: {
        plate_margins_pct: [
          ok([{ recipe_key: K1, food_cost_pct: 18.85, gp_pct: 81.15, status: "ok" }]),
        ],
      },
      results: {
        v_recipe_current: [ok([{ id: "v1", recipe_key: K1, name: "Piatto (demo)" }])],
        recipe_price: [ok([{ recipe_id: "v1", target_gp_pct: 70 }])],
      },
    });
    const { plates } = await getPlateMarginPcts(client as never);
    expect(client.rpc).toHaveBeenCalledWith("plate_margins_pct");
    expect(plates).toEqual([
      {
        recipeKey: K1,
        name: "Piatto (demo)",
        foodCostPct: 18.85,
        gpPct: 81.15,
        targetGpPct: 70,
        status: "ok",
      },
    ]);
  });

  it("an empty menu reads nothing else", async () => {
    const client = fakeSupabase({ rpc: { plate_margins_pct: [ok([])] } });
    expect(await getPlateMarginPcts(client as never)).toEqual({ plates: [] });
    expect(client.from).not.toHaveBeenCalled();
  });

  it("maps a database error", async () => {
    const client = fakeSupabase({
      rpc: { plate_margins_pct: [{ data: null, error: { code: "42501", message: "denied" } }] },
    });
    await expect(getPlateMarginPcts(client as never)).rejects.toBeInstanceOf(ApiError);
  });
});
