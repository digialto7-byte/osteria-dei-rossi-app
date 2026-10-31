import type { SupabaseClient } from "@supabase/supabase-js";
import { avtOutput } from "./output";
import { failReport, parseReport } from "./run";
import type { AvtQuery } from "./schemas";

/** GET /api/reports/avt: actual against theoretical consumption between two closed monthly counts; no count means the latest one. */
export async function getAvtReport(supabase: SupabaseClient, query: AvtQuery) {
  const { data, error } = await supabase.rpc("avt_report", { p_count: query.count ?? null });
  if (error) failReport("avt_report", error);
  return parseReport("avt_report", avtOutput, data);
}
