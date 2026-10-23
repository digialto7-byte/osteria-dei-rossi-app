import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrapCost } from "./errors";
import { nameLookup } from "./names";
import { mapPlateRow, type PlateCostRow } from "./plates";
import type { CostLine, PlateCost, RecipeCost } from "./types";

// recipe_cost_at already speaks camelCase (it builds one jsonb document); only the ingredient ids
// become named ingredients here.
type PlateDocument = Omit<PlateCost, "missingIngredients"> & { missingIngredientIds: string[] };
type CostDocument = Omit<RecipeCost, "missingIngredients" | "plate"> & {
  missingIngredientIds: string[];
  plate: PlateDocument | null;
};

function plateRowOf(plate: PlateDocument): PlateCostRow {
  return {
    recipe_key: plate.recipeKey,
    name: plate.name,
    version: plate.version,
    food_cost_eur: plate.foodCostEur,
    fixed_cost_eur: plate.fixedCostEur,
    full_cost_eur: plate.fullCostEur,
    sale_price_eur: plate.salePriceEur,
    vat_pct: plate.vatPct,
    sale_price_ex_vat_eur: plate.salePriceExVatEur,
    gross_margin_eur: plate.grossMarginEur,
    net_margin_eur: plate.netMarginEur,
    food_cost_pct: plate.foodCostPct,
    gp_pct: plate.gpPct,
    target_gp_pct: plate.targetGpPct,
    fixed_cost_allocated: plate.fixedCostAllocated,
    status: plate.status,
    reasons: plate.reasons,
    missing_ingredient_ids: plate.missingIngredientIds,
  };
}

/** The cost of one recipe on `at` (null = now) with its lines; the plate outputs for a plate. */
export async function getRecipeCost(
  supabase: SupabaseClient,
  key: string,
  at: string | null,
): Promise<RecipeCost> {
  const doc = unwrapCost<CostDocument>(
    await supabase.rpc("recipe_cost_at", { p_key: key, p_date: at }),
  );
  const missing = await nameLookup(supabase, [
    doc.missingIngredientIds,
    doc.plate?.missingIngredientIds,
  ]);
  return {
    recipeKey: doc.recipeKey,
    recipeId: doc.recipeId,
    version: doc.version,
    type: doc.type,
    name: doc.name,
    at: doc.at ?? null,
    totalCostEur: doc.totalCostEur,
    unitCostEur: doc.unitCostEur,
    costUnit: doc.costUnit,
    incomplete: doc.incomplete,
    reasons: doc.reasons ?? [],
    missingIngredients: missing(doc.missingIngredientIds),
    lines: (doc.lines ?? []) as CostLine[],
    plate: doc.plate
      ? mapPlateRow(plateRowOf(doc.plate), missing(doc.plate.missingIngredientIds))
      : null,
  };
}
