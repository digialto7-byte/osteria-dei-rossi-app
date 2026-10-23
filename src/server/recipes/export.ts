import type { SupabaseClient } from "@supabase/supabase-js";
import { mapRecipeDbError } from "./errors";
import type { RecipeTemplate } from "./types";

/** Every active recipe's current version in the import template's JSON shape, with its price. */
export async function exportRecipes(
  supabase: SupabaseClient,
): Promise<{ recipes: RecipeTemplate[] }> {
  const { data, error } = await supabase.rpc("export_recipes");
  if (error) throw mapRecipeDbError(error);
  return { recipes: (data as { recipes?: RecipeTemplate[] } | null)?.recipes ?? [] };
}
