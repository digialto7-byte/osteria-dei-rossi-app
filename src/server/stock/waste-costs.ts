import type { SupabaseClient } from "@supabase/supabase-js";
import { venueDate } from "@/lib/time/venue-date";
import { mapStockDbError } from "./errors";
import { wasteCostsResponse } from "./output";
import type { WasteCosts } from "./types";

/**
 * GET /api/stock/waste-costs: waste in EUR by reason and ingredient, for owner and admin only (the route refuses
 * the others before this runs; public.raw_waste_costs refuses them again with 42501). Without dates: the Rome month
 * so far. `now` is injectable for tests.
 */
export async function getWasteCosts(
  supabase: SupabaseClient,
  query: { from: string | null; to: string | null },
  now: Date = new Date(),
) {
  const to = query.to ?? venueDate(now);
  const from = query.from ?? `${to.slice(0, 8)}01`;
  const { data, error } = await supabase.rpc("raw_waste_costs", { p_from: from, p_to: to });
  if (error) throw mapStockDbError(error);
  const result = data as WasteCosts;
  return wasteCostsResponse.parse({
    from: result.from,
    to: result.to,
    valueEur: result.valueEur,
    unvaluedCount: result.unvaluedCount,
    reasons: result.reasons.map((reason) => ({
      reasonCode: reason.reasonCode,
      valueEur: reason.valueEur,
      lines: reason.lines.map((line) => ({
        ingredientId: line.ingredientId,
        ingredientName: line.ingredientName,
        baseUnit: line.baseUnit,
        qty: line.qty,
        valueEur: line.valueEur,
      })),
    })),
  });
}
