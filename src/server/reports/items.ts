import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppRole } from "@/lib/api/with-api";
import { adminItemsOutput, ownerItemsOutput } from "./output";
import { failReport, parseReport } from "./run";
import type { PeriodQuery } from "./schemas";

/**
 * GET /api/reports/items: one RPC, then the strict parse with the schema of the CALLER's role. The owner's rows carry the fixed-cost keys, the
 * admin's cannot (Q107): a reply that does not fit its role, or that names a key the schema does not know, is a 500 that never reaches the JSON.
 */
export async function getKpiItems(supabase: SupabaseClient, role: AppRole, query: PeriodQuery) {
  const { data, error } = await supabase.rpc("kpi_items", {
    p_period: query.period,
    p_date: query.date ?? null,
    p_from: query.from ?? null,
    p_to: query.to ?? null,
  });
  if (error) failReport("kpi_items", error);
  return parseReport("kpi_items", role === "owner" ? ownerItemsOutput : adminItemsOutput, data);
}
