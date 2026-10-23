import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrapCost } from "./errors";
import type { CostBasis, CostSettings, IngredientCost } from "./types";

interface IngredientCostRow {
  ingredient_id: string;
  name: string;
  base_unit: string;
  is_active: boolean;
  basis: CostBasis;
  unit_cost_eur: number | null;
  avg_eur: number | null;
  last_eur: number | null;
  max_eur: number | null;
  purchases_used: number;
  last_purchase_on: string | null;
}

export interface IngredientCostsResponse {
  at: string | null;
  avgCostN: number;
  ingredients: IngredientCost[];
}

/** Every ingredient with its cost basis and prices on `at` (null = now); no purchase means null, never 0. */
export async function getIngredientCosts(
  supabase: SupabaseClient,
  at: string | null,
): Promise<IngredientCostsResponse> {
  const rows =
    unwrapCost<IngredientCostRow[] | null>(
      await supabase.rpc("ingredient_costs", { p_date: at }),
    ) ?? [];
  const settings = unwrapCost<CostSettings>(await supabase.rpc("cost_settings"));
  return {
    at,
    avgCostN: settings.avgCostN,
    ingredients: rows.map((row) => ({
      id: row.ingredient_id,
      name: row.name,
      baseUnit: row.base_unit,
      isActive: row.is_active,
      basis: row.basis,
      unitCostEur: row.unit_cost_eur,
      avgEur: row.avg_eur,
      lastEur: row.last_eur,
      maxEur: row.max_eur,
      purchasesUsed: row.purchases_used,
      lastPurchaseOn: row.last_purchase_on,
    })),
  };
}
