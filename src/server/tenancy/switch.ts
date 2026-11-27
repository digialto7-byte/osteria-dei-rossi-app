import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/errors";
import type { LoginSession } from "@/lib/api/with-api";
import { reportError } from "@/lib/observability/report";

const FAILED = () =>
  new ApiError(503, "tenant_switch_failed", "Cambio locale non riuscito. Ricarica la pagina.");

/**
 * Changes the venue of this session (SP2 plan §3.4; #131 §3.4 row 4):
 * public.select_tenant stores the choice → refreshSession on the SAME route client (its cookie writer stores the new tokens) → getClaims must show
 * the tenant asked for. Errors and logs carry codes only, never a tenant name. A refresh that fails, or a new token with another tenant, is a 503
 * (Rule B: never a 200 for a session that may still be in the old venue); the client then reloads `/`.
 */
export async function switchTenant(
  supabase: SupabaseClient,
  session: LoginSession,
  tenantId: string,
): Promise<{ tenantId: string }> {
  // A staff PIN session is bound to one tenant and one device (ADR-010): refused from the claims, before any SQL. The database refuses it too.
  if (session.pinLogin) {
    throw new ApiError(403, "forbidden", "Operazione non consentita per il tuo ruolo.");
  }

  const { error } = await supabase.rpc("select_tenant", { p_tenant: tenantId });
  if (error) {
    if (error.code === "42501") {
      throw new ApiError(404, "tenant_not_found", "Locale non trovato.");
    }
    if (error.code === "P0001" && error.message === "tenant_switch_too_soon") {
      throw new ApiError(429, "tenant_switch_too_soon", "Aspetta qualche secondo e riprova.");
    }
    if (error.code === "P0001" && error.message === "session_missing") {
      throw new ApiError(401, "unauthenticated", "Accesso richiesto.");
    }
    throw new Error(`select_tenant failed: ${error.code ?? "no code"}`);
  }

  const refreshed = await supabase.auth.refreshSession();
  if (refreshed.error || !refreshed.data.session) {
    reportError(
      new Error(`tenant switch: refresh failed: ${refreshed.error?.code ?? "no session"}`),
    );
    throw FAILED();
  }

  const claims = await supabase.auth.getClaims();
  const newTenant = (claims.data?.claims as { tenant_id?: unknown } | undefined)?.tenant_id;
  if (claims.error || newTenant !== tenantId) {
    reportError(
      new Error(
        `tenant switch: the new token ${claims.error ? "could not be read" : "carries another tenant"}`,
      ),
    );
    throw FAILED();
  }
  return { tenantId };
}
