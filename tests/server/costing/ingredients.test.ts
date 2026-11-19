import { describe, expect, it } from "vitest";
import { costSourceOf, getIngredientCosts } from "@/server/costing/ingredients";
import { fakeSupabase, type FakeResult } from "../../helpers/fake-supabase";

// Opening stock step 16 (plan 2026-11-18 §3.7): costSource is derived server-side, with no signature change. After the fallback
// migration a non-null cost with zero purchases can only come from an opening row (pgTAP 414 pins that invariant).
const ok = (data: unknown): FakeResult => ({ data, error: null });
const row = (over: Record<string, unknown>) => ({
  ingredient_id: "1a000000-0000-4000-8000-000000000001",
  name: "Farina 00 (demo)",
  base_unit: "kg",
  is_active: true,
  basis: "moving_average",
  unit_cost_eur: 0.8,
  avg_eur: null,
  last_eur: null,
  max_eur: null,
  purchases_used: 0,
  last_purchase_on: null,
  ...over,
});

describe("costSourceOf", () => {
  it("an ingredient row with unit_cost 0.8 and purchases_used 0 maps to 'opening'", () => {
    expect(costSourceOf(0.8, 0)).toBe("opening");
  });
  it("purchasesUsed 2 maps to 'invoice'; a null cost to null", () => {
    expect(costSourceOf(1.1, 2)).toBe("invoice");
    expect(costSourceOf(null, 0)).toBeNull();
    expect(costSourceOf(0, 0)).toBe("opening");
  });
});

describe("getIngredientCosts", () => {
  it("puts costSource on every ingredient", async () => {
    const client = fakeSupabase({
      rpc: {
        ingredient_costs: [
          ok([
            row({}),
            row({ unit_cost_eur: 1.1, avg_eur: 1.1, purchases_used: 2 }),
            row({ unit_cost_eur: null }),
          ]),
        ],
        cost_settings: [ok({ avgCostN: 3, priceVariancePct: 10, saleVatPct: 10 })],
      },
    });
    const result = await getIngredientCosts(client as never, null);
    expect(result.ingredients.map((i) => i.costSource)).toEqual(["opening", "invoice", null]);
  });
});
