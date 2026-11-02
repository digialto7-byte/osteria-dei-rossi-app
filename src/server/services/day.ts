import type { SupabaseClient } from "@supabase/supabase-js";
import { mapServicesDbError } from "./errors";
import { dayServicesOutput } from "./output";

/**
 * GET /api/day-close/services: the app's split of one business day by service (tables, covers, frozen totals, open tables) and the day's sessions
 * with their service. The register stays one total per day: the difference is read from /api/reports/app-vs-register. No date means today's.
 */
export async function getDayServices(supabase: SupabaseClient, date?: string) {
  const { data, error } = await supabase.rpc("day_services", { p_date: date ?? null });
  if (error) throw mapServicesDbError(error);
  return dayServicesOutput.parse(data);
}
