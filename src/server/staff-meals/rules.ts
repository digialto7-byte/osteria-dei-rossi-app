import type { SupabaseClient } from "@supabase/supabase-js";
import { mapStaffMealDbError } from "./errors";
import { staffMealRule, staffMealRules } from "./output";
import type { RuleBody } from "./schemas";
import type { StaffMealRuleResult, StaffMealRules } from "./types";

/**
 * GET /api/staff-meals: the rules of the tenant with the business date, what is available and today's confirmation
 * (public.staff_meal_rules). Quantities only. The answer is built field by field.
 */
export async function listStaffMealRules(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("staff_meal_rules");
  if (error) throw mapStaffMealDbError(error);
  const d = data as StaffMealRules;
  return staffMealRules.parse({
    businessDate: d.businessDate,
    rules: d.rules.map((r) => ({
      ruleId: r.ruleId,
      kind: r.kind,
      targetId: r.targetId,
      name: r.name,
      unit: r.unit,
      defaultCount: r.defaultCount,
      locationId: r.locationId,
      isActive: r.isActive,
      available: r.available,
      today: r.today
        ? {
            confirmationId: r.today.confirmationId,
            count: r.today.count,
            at: r.today.at,
            byInitials: r.today.byInitials,
          }
        : null,
    })),
  });
}

/**
 * POST /api/staff-meals: creates or updates the rule of a target (an upsert by target; public.set_staff_meal_rule
 * audits it). `created` only picks the status, 201 or 200, and is not sent on.
 */
export async function saveStaffMealRule(supabase: SupabaseClient, body: RuleBody) {
  const forRecipe = "recipeKey" in body;
  const { data, error } = await supabase.rpc("set_staff_meal_rule", {
    p_recipe_key: forRecipe ? body.recipeKey : null,
    p_ingredient_id: forRecipe ? null : body.ingredientId,
    p_default_count: body.defaultCount,
    p_unit: forRecipe ? null : body.unit,
    p_location: forRecipe ? null : (body.locationId ?? null),
    p_is_active: body.isActive ?? true,
  });
  if (error) throw mapStaffMealDbError(error);
  const r = data as StaffMealRuleResult;
  return {
    created: r.created === true,
    rule: staffMealRule.parse({
      ruleId: r.ruleId,
      kind: r.kind,
      targetId: r.targetId,
      defaultCount: r.defaultCount,
      locationId: r.locationId,
      isActive: r.isActive,
    }),
  };
}
