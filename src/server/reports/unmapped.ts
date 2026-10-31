import type { SupabaseClient } from "@supabase/supabase-js";
import { unmappedOutput } from "./output";
import { failReport, parseReport } from "./run";
import type { UnmappedQuery } from "./schemas";

/** GET /api/reports/unmapped-items: what was sold without a recipe in an ISO week; no week means the current one. */
export async function getUnmappedItems(supabase: SupabaseClient, query: UnmappedQuery) {
  const { data, error } = await supabase.rpc("unmapped_items", { p_week: query.week ?? null });
  if (error) failReport("unmapped_items", error);
  return parseReport("unmapped_items", unmappedOutput, data);
}
