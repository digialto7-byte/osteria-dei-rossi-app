import type { SupabaseClient } from "@supabase/supabase-js";
import { mapStaffMealDbError } from "./errors";
import { staffMealConfirmation } from "./output";
import type { ConfirmBody } from "./schemas";
import type { StaffMealConfirmation } from "./types";

/**
 * POST /api/staff-meals/:id/confirm: records today's staff meal of a rule, once per business day. One RPC, one
 * transaction: the confirmation row (unique per rule and business date) and the consumption, FEFO from the recipe's
 * batches or through the stock engine for an ingredient. The answer carries quantities only.
 */
export async function confirmStaffMeal(
  supabase: SupabaseClient,
  ruleId: string,
  body: ConfirmBody,
) {
  const { data, error } = await supabase.rpc("confirm_staff_meal", {
    p_rule: ruleId,
    p_count: body.count ?? null,
  });
  if (error) throw mapStaffMealDbError(error);
  const r = data as StaffMealConfirmation;
  return staffMealConfirmation.parse({
    confirmationId: r.confirmationId,
    ruleId: r.ruleId,
    businessDate: r.businessDate,
    count: r.count,
    movements: r.movements.map((m) =>
      "batchId" in m
        ? { batchId: m.batchId, portions: m.portions }
        : { ingredientId: m.ingredientId, qty: m.qty },
    ),
    negatives: r.negatives.map((n) => ({
      ingredientId: n.ingredientId,
      locationId: n.locationId,
      onHandQty: n.onHandQty,
    })),
  });
}
