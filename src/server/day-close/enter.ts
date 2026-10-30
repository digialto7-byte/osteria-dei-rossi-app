import type { SupabaseClient } from "@supabase/supabase-js";
import { mapDayCloseDbError } from "./errors";
import { enterDayCloseOutput } from "./output";
import type { DayCloseBody } from "./schemas";

/**
 * POST /api/day-close: the owner's register total for a business date, as an append-only entry. The reply carries the report, so the
 * difference is on screen the moment the total is saved (M21 plan §3.1.7).
 */
export async function enterDayClose(supabase: SupabaseClient, body: DayCloseBody) {
  const { data, error } = await supabase.rpc("enter_day_close", { p_body: body });
  if (error) throw mapDayCloseDbError(error);
  return enterDayCloseOutput.parse(data);
}
