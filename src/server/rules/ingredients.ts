import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppRole } from "@/lib/api/with-api";
import { mapRulesDbError } from "./errors";
import {
  ingredientRulesChange,
  ingredientRulesChefResponse,
  ingredientRulesPatchResponse,
  ingredientRulesResponse,
} from "./output";
import type { IngredientRulesBody } from "./schemas";

/**
 * GET /api/rules/ingredients. Owner and admin get the supplier choices too; the chef's reply has no such key and the
 * strict schema refuses one. The database decides what each role sees; this only parses it.
 */
export async function listIngredientRules(supabase: SupabaseClient, role: AppRole) {
  const { data, error } = await supabase.rpc("rules_ingredients");
  if (error) throw mapRulesDbError(error);
  const schema =
    role === "owner" || role === "admin" ? ingredientRulesResponse : ingredientRulesChefResponse;
  return schema.parse(data);
}

/** PATCH /api/rules/ingredients: one audited procedure call, then a read for the item as the screen shows it. */
export async function setIngredientRules(supabase: SupabaseClient, body: IngredientRulesBody) {
  const { ingredientId, ...patch } = body;
  const { data, error } = await supabase.rpc("set_ingredient_rules", {
    p_ingredient: ingredientId,
    p_patch: patch,
  });
  if (error) throw mapRulesDbError(error);
  const change = ingredientRulesChange.parse(data);
  const read = await listIngredientRules(supabase, "owner");
  return ingredientRulesPatchResponse.parse({
    ingredientId: change.ingredientId,
    changed: change.changed,
    item: read.items.find((item) => item.ingredientId === change.ingredientId) ?? null,
  });
}
