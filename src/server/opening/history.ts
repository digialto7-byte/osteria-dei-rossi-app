import type { SupabaseClient } from "@supabase/supabase-js";
import { mapOpeningDbError } from "./errors";
import { historyResponse, summaryResponse } from "./output";

/** GET /api/stock/opening/history?locationId=: the location's operations, newest first, at most 50 (plan 2026-11-18 §3.5). */
export async function getOpeningHistory(supabase: SupabaseClient, locationId: string) {
  const { data, error } = await supabase.rpc("opening_history", { p_location: locationId });
  if (error) throw mapOpeningDbError(error);
  return historyResponse.parse(data);
}

/** For /api/today: {booked, draftLines}, owner and admin only. No money. */
export async function getOpeningSummary(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("opening_stock_summary", {});
  if (error) throw mapOpeningDbError(error);
  return summaryResponse.parse(data);
}
