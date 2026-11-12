import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/errors";
import { classifySignIn, toLogSafe } from "@/lib/auth/auth-errors";
import { t } from "@/lib/i18n";
import { reportError } from "@/lib/observability/report";
import { callAuth } from "./auth-call";
import { afterFirstFactor, redirectAfterSignIn } from "./redirect";

/**
 * Signs an owner or admin in with Supabase Auth's e-mail/password (ADR-029 decision 1). The session lands in the
 * cookie-bound client's HttpOnly cookies. The password policy is not applied here: an existing password always works.
 * Nothing is logged except the status and code of an unexpected Auth answer.
 */
export async function passwordSignIn(
  supabase: SupabaseClient,
  input: { email: string; password: string; next?: string },
): Promise<{ redirect: string }> {
  const { error } = await callAuth(
    supabase.auth.signInWithPassword({ email: input.email, password: input.password }),
  );
  if (error) {
    const outcome = classifySignIn(error);
    if (outcome === "invalid") {
      throw new ApiError(401, "login_invalid", t("authError.login_invalid"));
    }
    if (outcome === "rate_limited") {
      throw new ApiError(429, "rate_limited", t("authError.rate_limited"));
    }
    const { status, code } = toLogSafe(error);
    reportError(
      new Error(`password sign-in failed: ${status ?? "no status"} ${code ?? "no code"}`),
    );
    throw new ApiError(502, "upstream_error", t("authError.upstream_error"));
  }
  const { data } = await supabase.auth.getClaims();
  const claims = (data?.claims ?? {}) as { tenant_id?: string; app_role?: string; aal?: string };
  // P2-1: the password is the first factor; an owner or admin may still owe the code.
  return {
    redirect: await afterFirstFactor(supabase, claims, redirectAfterSignIn(claims, input.next)),
  };
}
