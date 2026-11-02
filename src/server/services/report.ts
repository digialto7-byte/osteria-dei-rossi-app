import type { SupabaseClient } from "@supabase/supabase-js";
import type { PeriodQuery } from "@/server/reports/schemas";
import { failReport, parseReport } from "@/server/reports/run";
import { servicesReportOutput } from "./output";

/**
 * GET /api/reports/services: the sales of a period split by service, with the KPI report's periods and rules (M25c plan §3.1.8). One RPC, then the
 * strict parse; the total equals kpi_report's current block for the shared keys.
 */
export async function getServicesReport(supabase: SupabaseClient, query: PeriodQuery) {
  const { data, error } = await supabase.rpc("kpi_services", {
    p_period: query.period,
    p_date: query.date ?? null,
    p_from: query.from ?? null,
    p_to: query.to ?? null,
  });
  if (error) failReport("kpi_services", error);
  return parseReport("kpi_services", servicesReportOutput, data);
}
