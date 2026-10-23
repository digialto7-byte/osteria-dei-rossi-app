import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrapCost } from "./errors";
import type { CostBasis } from "./types";

export interface CostBasisChange {
  ingredientId: string;
  basis: CostBasis;
  validFrom: string | null;
}

/** Appends a basis row for the ingredient (the same basis again returns the row in force). */
export async function setIngredientCostBasis(
  supabase: SupabaseClient,
  ingredientId: string,
  basis: CostBasis,
): Promise<CostBasisChange> {
  const data = unwrapCost<CostBasisChange>(
    await supabase.rpc("set_ingredient_cost_basis", { p_ingredient: ingredientId, p_basis: basis }),
  );
  return { ingredientId: data.ingredientId, basis: data.basis, validFrom: data.validFrom ?? null };
}
