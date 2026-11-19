import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrapCost } from "./errors";
import type { CostBasis, CostSettings, CostSource, IngredientCost } from "./types";

export interface IngredientCostRow {
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

/** 'invoice' once a purchase is in force, 'opening' for the carico fallback (ADR-048), null without any cost. */
export function costSourceOf(unitCost: number | null, purchasesUsed: number): CostSource {
  if (unitCost === null) return null;
  return purchasesUsed > 0 ? "invoice" : "opening";
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
      costSource: costSourceOf(row.unit_cost_eur, row.purchases_used),
    })),
  };
}
