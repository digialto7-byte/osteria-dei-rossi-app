import { describe, expect, it } from "vitest";
import { getRecipeCost } from "@/server/costing/recipe-cost";
import { fakeSupabase, type FakeResult } from "../../helpers/fake-supabase";

// Opening stock step 16 (plan 2026-11-18 §3.7, spec §7.7): each ingredient line of a recipe cost says where its unit cost comes
// from ("Costo da carico iniziale" on the screen). One extra call to ingredient_costs with the same date; sub-recipe lines get null.
const ok = (data: unknown): FakeResult => ({ data, error: null });
const KEY = "ec000000-0000-4000-8000-0000000000e1";
const FLOUR = "1a000000-0000-4000-8000-000000000001";
const BEEF = "1a000000-0000-4000-8000-000000000002";
const SUB = "ec000000-0000-4000-8000-0000000000e2";
const line = (position: number, kind: "ingredient" | "recipe", id: string) => ({
  position,
  target: { kind, id, name: `x${position}` },
  qty: 1,
  unit: "kg",
  yieldFactor: 1,
  unitCostEur: 1,
  lineCostEur: 1,
  incomplete: false,
  reason: null,
});
const COST = {
  recipeKey: KEY,
  recipeId: "ee000000-0000-4000-8000-0000000000ee",
  version: 1,
  type: "plate",
  name: "Pizza (demo)",
  at: "2026-12-01",
  totalCostEur: 3,
  unitCostEur: 3,
  costUnit: "porz",
  incomplete: false,
  reasons: [],
  missingIngredientIds: [],
  lines: [line(1, "ingredient", FLOUR), line(2, "ingredient", BEEF), line(3, "recipe", SUB)],
  plate: null,
};
const ingredientRow = (id: string, unit: number | null, used: number) => ({
  ingredient_id: id,
  name: id,
  base_unit: "kg",
  is_active: true,
  basis: "moving_average",
  unit_cost_eur: unit,
  avg_eur: null,
  last_eur: null,
  max_eur: null,
  purchases_used: used,
  last_purchase_on: null,
});

describe("getRecipeCost and costSource", () => {
  it("calls ingredient_costs once with the same p_date and puts costSource on each ingredient line, null on sub-recipe lines", async () => {
    const client = fakeSupabase({
      rpc: {
        recipe_cost_at: [ok(COST)],
        ingredient_costs: [ok([ingredientRow(FLOUR, 0.8, 0), ingredientRow(BEEF, 10, 3)])],
      },
    });
    const cost = await getRecipeCost(client as never, KEY, "2026-12-01");
    expect(client.rpc).toHaveBeenCalledWith("ingredient_costs", { p_date: "2026-12-01" });
    expect(client.rpc.mock.calls.filter((c) => c[0] === "ingredient_costs")).toHaveLength(1);
    expect(cost.lines.map((l) => l.costSource)).toEqual(["opening", "invoice", null]);
  });

  it("an ingredient missing from the list (no price at all) gets null", async () => {
    const client = fakeSupabase({
      rpc: { recipe_cost_at: [ok(COST)], ingredient_costs: [ok([])] },
    });
    const cost = await getRecipeCost(client as never, KEY, null);
    expect(cost.lines.map((l) => l.costSource)).toEqual([null, null, null]);
  });
});
