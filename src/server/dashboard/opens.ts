import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { failReport, parseReport } from "@/server/reports/run";

export const MAX_OPENS_BODY_BYTES = 64;
/** The body of POST /api/dashboard/opens: nothing. The user, the tenant and the week come from the session and the clock. */
export const opensBody = z.strictObject({});
const opensOutput = z.strictObject({ isoWeek: z.iso.date(), opens: z.number().int().positive() });

/** Counts one open of Oggi for the owner in the venue's ISO week (M22 plan §3.1.11): count only, no time, no device. */
export async function recordDashboardOpen(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("record_dashboard_open");
  if (error) failReport("record_dashboard_open", error);
  return parseReport("record_dashboard_open", opensOutput, data);
}
