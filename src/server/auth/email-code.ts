import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/errors";
import { classifyVerify, toLogSafe } from "@/lib/auth/auth-errors";
import { t } from "@/lib/i18n";
import { reportError } from "@/lib/observability/report";
import { callAuth } from "./auth-call";
import { redirectAfterCodeSignIn } from "./redirect";

/**
 * Signs in with the 6-digit code of the sign-in e-mail (ADR-029 decision 2). The person types the code into their
 * own app, so this does not reopen the login-CSRF hole that the callback closes for bare token hashes.
 */
export async function emailCodeSignIn(
  supabase: SupabaseClient,
  input: { email: string; code: string; next?: string },
): Promise<{ redirect: string }> {
  const { error } = await callAuth(
    supabase.auth.verifyOtp({ email: input.email, token: input.code, type: "email" }),
  );
  if (error) {
    const outcome = classifyVerify(error);
    if (outcome === "code_invalid") {
      throw new ApiError(422, "code_invalid", t("authError.code_invalid"));
    }
    if (outcome === "rate_limited") {
      throw new ApiError(429, "rate_limited", t("authError.rate_limited"));
    }
    const { status, code } = toLogSafe(error);
    reportError(
      new Error(`email-code sign-in failed: ${status ?? "no status"} ${code ?? "no code"}`),
    );
    throw new ApiError(502, "upstream_error", t("authError.upstream_error"));
  }
  const { data } = await supabase.auth.getClaims();
  const claims = (data?.claims ?? {}) as { tenant_id?: string; app_role?: string };
  return { redirect: redirectAfterCodeSignIn(claims, input.next) };
}
