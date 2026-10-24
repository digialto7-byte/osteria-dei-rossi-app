import type { SupabaseClient } from "@supabase/supabase-js";
import { mapRulesDbError } from "./errors";
import { recipeRulesChange, recipeRulesPatchResponse, recipeRulesResponse } from "./output";
import type { RecipeRulesBody } from "./schemas";

/** GET /api/rules/recipes: the batch recipes with their effective rules, where each comes from, and what is left. */
export async function listRecipeRules(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("rules_recipes");
  if (error) throw mapRulesDbError(error);
  return recipeRulesResponse.parse(data);
}

/** PATCH /api/rules/recipes: one audited procedure call (no new recipe version), then a read for the item. */
export async function setRecipeRules(supabase: SupabaseClient, body: RecipeRulesBody) {
  const { recipeKey, ...patch } = body;
  const { data, error } = await supabase.rpc("set_recipe_rules", {
    p_recipe_key: recipeKey,
    p_patch: patch,
  });
  if (error) throw mapRulesDbError(error);
  const change = recipeRulesChange.parse(data);
  const read = await listRecipeRules(supabase);
  return recipeRulesPatchResponse.parse({
    recipeKey: change.recipeKey,
    changed: change.changed,
    item: read.items.find((item) => item.recipeKey === change.recipeKey) ?? null,
  });
}
