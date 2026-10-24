import type { SupabaseClient } from "@supabase/supabase-js";
import { mapCountDbError } from "./errors";
import { varianceCostsResponse } from "./output";
import type { VarianceCosts } from "./types";

/**
 * GET /api/reports/variance-costs: the variance of a closed count in EUR, for owner and admin only (the route refuses
 * the others before this runs; public.count_variance_costs refuses them again with 42501). A value is null, never 0,
 * when a posted row has no cost.
 */
export async function getVarianceCosts(
  supabase: SupabaseClient,
  session: string,
): Promise<VarianceCosts> {
  const { data, error } = await supabase.rpc("count_variance_costs", { p_session: session });
  if (error) throw mapCountDbError(error);
  const v = data as VarianceCosts;
  return varianceCostsResponse.parse({
    sessionId: v.sessionId,
    valueEur: v.valueEur,
    lossEur: v.lossEur,
    gainEur: v.gainEur,
    unvaluedCount: v.unvaluedCount,
    lines: v.lines.map((l) => ({ ingredientId: l.ingredientId, valueEur: l.valueEur })),
  });
}
