import type { SupabaseClient } from "@supabase/supabase-js";
import { mapOpeningDbError } from "./errors";
import { historyResponse } from "./output";

/** GET /api/stock/opening/history?locationId=: the location's operations, newest first, at most 50 (plan 2026-11-18 §3.5). */
export async function getOpeningHistory(supabase: SupabaseClient, locationId: string) {
  const { data, error } = await supabase.rpc("opening_history", { p_location: locationId });
  if (error) throw mapOpeningDbError(error);
  return historyResponse.parse(data);
}
// The {booked, draftLines} summary for the set-up step is read by readOpeningBooked (src/server/today/summary.ts), with the summary's own errors.
