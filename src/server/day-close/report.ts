import type { SupabaseClient } from "@supabase/supabase-js";
import { mapDayCloseDbError } from "./errors";
import { appVsRegisterOutput } from "./output";

/** GET /api/reports/app-vs-register: the app's total against the register's, computed live (M21 plan §3.1.6). No date means today's. */
export async function getAppVsRegister(supabase: SupabaseClient, date?: string) {
  const { data, error } = await supabase.rpc("app_vs_register", { p_date: date ?? null });
  if (error) throw mapDayCloseDbError(error);
  return appVsRegisterOutput.parse(data);
}
