import type { SupabaseClient } from "@supabase/supabase-js";
import { mapCountDbError } from "./errors";
import { varianceResponse } from "./output";
import { mapSession } from "./sessions";
import type { Variance } from "./types";

/** GET /api/reports/variance: expected vs counted for a closed count, in quantities only. */
export async function getVariance(supabase: SupabaseClient, session: string): Promise<Variance> {
  const { data, error } = await supabase.rpc("count_variance", { p_session: session });
  if (error) throw mapCountDbError(error);
  const v = data as Variance;
  return varianceResponse.parse({
    session: mapSession(v.session),
    linesSkipped: v.linesSkipped,
    lines: v.lines.map((l) => ({
      ingredientId: l.ingredientId,
      name: l.name,
      baseUnit: l.baseUnit,
      expectedQty: l.expectedQty,
      countedQty: l.countedQty,
      differenceQty: l.differenceQty,
      postedQty: l.postedQty,
    })),
  });
}
