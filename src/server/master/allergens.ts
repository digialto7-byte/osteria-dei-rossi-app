import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { mapDbError } from "./db-errors";
import { allergenList, ingredientSpec, type Ingredient } from "./ingredients";
import { getRow } from "./resource";

export const confirmAllergensBody = z.strictObject({ allergens: allergenList });
export type ConfirmAllergensBody = z.infer<typeof confirmAllergensBody>;

/**
 * Records a person's confirmation of an ingredient's allergen list (owner, admin). The role,
 * tenant and idempotence are decided by the database procedure; this maps its errors and returns
 * the refreshed ingredient.
 */
export async function confirmIngredientAllergens(
  supabase: SupabaseClient,
  ingredientId: string,
  body: ConfirmAllergensBody,
): Promise<Ingredient> {
  const { error } = await supabase.rpc("confirm_ingredient_allergens", {
    p_ingredient: ingredientId,
    p_allergens: body.allergens,
  });
  if (error) throw mapDbError(error);
  return getRow(supabase, ingredientSpec, ingredientId);
}
