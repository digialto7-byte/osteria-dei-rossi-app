import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/errors";
import type { AppRole } from "@/lib/api/with-api";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { reportError } from "@/lib/observability/report";
import { dashboardOutput, type DashboardOutput } from "./output";
import { renderDashboard } from "./render";
import { dashboardSqlSchema } from "./sql-schema";

const unavailable = () =>
  new ApiError(500, "dashboard_unavailable", "Il cruscotto non è disponibile. Riprova tra poco.");

/**
 * The owner's or admin's dashboard: ONE database call, then the strict parse of its document, the rendering of the
 * alerts, and the strict parse of the answer. Logs carry codes only, never a message, a path or a value.
 */
export async function dashboardSummary(
  supabase: SupabaseClient,
  role: AppRole,
  locale: Locale = DEFAULT_LOCALE,
): Promise<DashboardOutput> {
  const { data, error } = await supabase.rpc("dashboard_summary");
  if (error) {
    if (error.code === "42501") {
      throw new ApiError(403, "forbidden", "Operazione non consentita per il tuo ruolo.");
    }
    reportError(new Error(`dashboard_summary failed: ${error.code ?? "no_code"}`));
    throw unavailable();
  }
  const sql = dashboardSqlSchema.safeParse(data);
  if (!sql.success || sql.data.role !== role) {
    reportError(new Error("dashboard_summary document rejected"));
    throw unavailable();
  }
  const output = dashboardOutput.safeParse(renderDashboard(sql.data, locale));
  if (!output.success) {
    reportError(new Error("dashboard output rejected"));
    throw unavailable();
  }
  return output.data;
}
