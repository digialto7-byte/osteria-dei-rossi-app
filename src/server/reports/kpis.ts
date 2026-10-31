import type { SupabaseClient } from "@supabase/supabase-js";
import { failReport, parseReport } from "./run";
import { kpiReportOutput } from "./output";
import type { PeriodQuery } from "./schemas";

/** GET /api/reports/kpis: one RPC, then the strict parse (M22 plan §3.5). A missing date or end goes to the database as null. */
export async function getKpiReport(supabase: SupabaseClient, query: PeriodQuery) {
  const { data, error } = await supabase.rpc("kpi_report", {
    p_period: query.period,
    p_date: query.date ?? null,
    p_from: query.from ?? null,
    p_to: query.to ?? null,
  });
  if (error) failReport("kpi_report", error);
  return parseReport("kpi_report", kpiReportOutput, data);
}
