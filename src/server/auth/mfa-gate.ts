import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/errors";
import { t } from "@/lib/i18n";

// P2-1 (docs/plans/2026-11-12-p2-1-totp.md T-5): the early, clear answer of the API for the second factor. Postgres is authoritative: the helpers app.tenant_id(),
// app.role() and app.app_user_id() already return nothing for an owner or admin who needs aal2 and has not got it, so every query fails closed anyway. This check
// only turns that into a precise 403 for the screens: mfa_required (a code from the authenticator is needed) or mfa_enrol_required (the account must enrol).

const GATED_ROLES = new Set(["owner", "admin"]);

export interface MfaGateClaims {
  aal?: string;
  app_role?: string;
  login?: string;
}

/** An owner or admin whose token is not aal2 (a missing claim is aal1). PIN sessions and every other role are never asked. */
export function mightNeedSecondFactor(claims: MfaGateClaims): boolean {
  if (claims.login === "pin") return false;
  if (!GATED_ROLES.has(claims.app_role ?? "")) return false;
  return claims.aal !== "aal2";
}

/** Asks public.mfa_gate() and throws the 403 for `challenge` and `enrol`. Any other answer or error is an internal error (reported with the code only). */
export async function enforceMfaGate(
  claims: MfaGateClaims,
  supabase: SupabaseClient,
): Promise<void> {
  if (!mightNeedSecondFactor(claims)) return;
  const { data, error } = await supabase.rpc("mfa_gate");
  if (error) throw new Error(`mfa_gate failed: ${error.code ?? "no code"}`);
  if (data === "ok") return;
  if (data === "challenge") {
    throw new ApiError(403, "mfa_required", t("authError.mfa_required"));
  }
  if (data === "enrol") {
    throw new ApiError(403, "mfa_enrol_required", t("authError.mfa_enrol_required"));
  }
  throw new Error("mfa_gate returned an unknown answer");
}
