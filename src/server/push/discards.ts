import type { SupabaseClient } from "@supabase/supabase-js";
import { discardsOutput } from "./output";
import { failRead, parseRead } from "./read";
import type { DiscardsQuery } from "./schemas";

/** GET /api/reports/discards-vs-push: the batches thrown away in an ISO week, per recipe, and whether a plate using them was pushed. */
export async function getDiscardsVsPush(supabase: SupabaseClient, query: DiscardsQuery) {
  const { data, error } = await supabase.rpc("discards_vs_push", { p_week: query.week ?? null });
  if (error) failRead("discards_vs_push", error);
  return parseRead("discards_vs_push", discardsOutput, data);
}
