import type { SupabaseClient } from "@supabase/supabase-js";
import { safeNextPath } from "@/lib/api/safe-next";
import { APP_ROLES, type AppRole } from "@/lib/api/with-api";
import { landingFor } from "@/lib/nav/nav-model";
import { MFA_OFFER_PAGE_READY } from "@/lib/auth/mfa-constants";
import { reportError } from "@/lib/observability/report";
import { dbStatus } from "@/server/auth/mfa-schemas";

/** Where a person goes after signing in (plan §3.1.1): a real `next`, else the role's landing page. */
export function redirectAfterSignIn(
  claims: { tenant_id?: string; app_role?: string },
  next?: string,
): string {
  const safe = safeNextPath(next);
  if (safe !== "/") return safe;
  if (!claims.tenant_id) return "/";
  const role = claims.app_role as AppRole;
  return (APP_ROLES as readonly string[]).includes(role) ? landingFor(role) : "/";
}

/** After a code sign-in, owner and admin are offered /password first (plan §3.1.2). */
export function redirectAfterCodeSignIn(
  claims: { tenant_id?: string; app_role?: string },
  next?: string,
): string {
  const safe = safeNextPath(next);
  const offersPassword =
    Boolean(claims.tenant_id) && ["owner", "admin"].includes(claims.app_role ?? "");
  if (!offersPassword || safe === "/password" || safe.startsWith("/password?")) {
    return redirectAfterSignIn(claims, next);
  }
  return `/password?dopo=${encodeURIComponent(safe)}`;
}

const SECOND_FACTOR_ROLES = ["owner", "admin"];

/**
 * After the first factor (password, e-mail code or magic link) an owner or admin may still owe the second one (P2-1, plan section 3.14). Asks public.mfa_status() and
 * returns the page to go to: the code (`challenge`), the forced enrolment (`enrol`), the offer (no factor yet, mode not off), or `target` itself. `target` is the
 * place the person wanted to reach; it is made safe once here and carried as the `next` parameter, so no open redirect can pass through. Chef, waiter, an account
 * without a tenant and a token already at aal2 make no call. A failing call falls back to `target` (reported by code only): the database gate still stops every query.
 */
export async function afterFirstFactor(
  supabase: SupabaseClient,
  claims: { tenant_id?: string; app_role?: string; aal?: string },
  target: string,
): Promise<string> {
  const safe = safeNextPath(target);
  if (!claims.tenant_id || !SECOND_FACTOR_ROLES.includes(claims.app_role ?? "")) return safe;
  if (claims.aal === "aal2") return safe;
  const { data, error } = await supabase.rpc("mfa_status");
  const status = dbStatus.safeParse(data);
  if (error || !status.success) {
    reportError(new Error(`mfa_status failed: ${error?.code ?? "unknown answer"}`));
    return safe;
  }
  const next = `?next=${encodeURIComponent(safe)}`;
  if (status.data.gate === "challenge") return `/login/codice${next}`;
  if (status.data.gate === "enrol") return `/login/attiva-codice${next}`;
  if (MFA_OFFER_PAGE_READY && !status.data.hasVerifiedFactor && status.data.mode !== "off") {
    return `/login/offerta-codice${next}`;
  }
  return safe;
}
