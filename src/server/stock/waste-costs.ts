import type { SupabaseClient } from "@supabase/supabase-js";
import { mapStockDbError } from "./errors";
import { wasteCostsResponse } from "./output";
import type { WasteCosts } from "./types";

/**
 * GET /api/stock/waste-costs: waste in EUR by reason, raw ingredients (by ingredient) and prepared batches (by
 * recipe) together, for owner and admin only (the route refuses the others before this runs; public.waste_costs
 * refuses them again with 42501). Batch waste is valued at read time from the frozen batch cost and is null, never 0,
 * when that cost is incomplete. Without dates: the business month so far, up to the business date (the day runs to the tenant's cut-off,
 * 02:00 by default, so it is not the calendar date between 00:00 and then; `public.business_date_of` decides it in SQL, where the cut-off lives).
 * `now` is injectable for tests.
 */
export async function getWasteCosts(
  supabase: SupabaseClient,
  query: { from: string | null; to: string | null },
  now: Date = new Date(),
) {
  let to = query.to;
  if (to === null) {
    const today = await supabase.rpc("business_date_of", { p_at: now.toISOString() });
    if (today.error) throw mapStockDbError(today.error);
    to = today.data as string;
  }
  const from = query.from ?? `${to.slice(0, 8)}01`;
  const { data, error } = await supabase.rpc("waste_costs", { p_from: from, p_to: to });
  if (error) throw mapStockDbError(error);
  const result = data as WasteCosts;
  return wasteCostsResponse.parse({
    from: result.from,
    to: result.to,
    valueEur: result.valueEur,
    rawValueEur: result.rawValueEur,
    batchValueEur: result.batchValueEur,
    unvaluedCount: result.unvaluedCount,
    reasons: result.reasons.map((reason) => ({
      reasonCode: reason.reasonCode,
      valueEur: reason.valueEur,
      rawValueEur: reason.rawValueEur,
      batchValueEur: reason.batchValueEur,
      lines: reason.lines.map((line) => ({
        ingredientId: line.ingredientId,
        ingredientName: line.ingredientName,
        baseUnit: line.baseUnit,
        qty: line.qty,
        valueEur: line.valueEur,
      })),
      batchLines: reason.batchLines.map((line) => ({
        recipeKey: line.recipeKey,
        recipeName: line.recipeName,
        portions: line.portions,
        valueEur: line.valueEur,
        unvaluedCount: line.unvaluedCount,
      })),
    })),
  });
}
