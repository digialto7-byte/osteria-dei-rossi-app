import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppRole } from "@/lib/api/with-api";
import { chefForecastOutput, managerForecastOutput } from "./output";
import { failRead, parseRead } from "./read";
import type { ForecastQuery } from "./schemas";

/** GET /api/reports/forecast: the same weekday of the last four open weeks. The chef's reply has no covers; a reply with them is a 500. */
export async function getForecast(supabase: SupabaseClient, role: AppRole, query: ForecastQuery) {
  const { data, error } = await supabase.rpc("forecast", { p_date: query.date ?? null });
  if (error) failRead("forecast", error);
  return parseRead("forecast", role === "chef" ? chefForecastOutput : managerForecastOutput, data);
}
