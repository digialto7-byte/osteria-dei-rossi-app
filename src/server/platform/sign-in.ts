import { ApiError } from "@/lib/api/errors";
import { classifySignIn, toLogSafe } from "@/lib/auth/auth-errors";
import { t } from "@/lib/i18n";
import { reportError } from "@/lib/observability/report";
import { callAuth } from "@/server/auth/auth-call";
import type { PlatformDb } from "@/server/platform/rpc";

// SP3 step 17 (plan §3.4.4, §3.6 step 1; Q-P4): the console's password sign-in. Supabase Auth checks the password; then Postgres says whether the account is
// platform staff (platform_mfa_attempt_allowed answers 42501 to anyone else). Anyone else is signed out at once with 403 not_console_account. The reply names
// the next page: the code page, or the enrolment page while the account has no verified factor. Nothing is logged but an Auth status and code.

export type ConsoleSignInRedirect = "/login/codice" | "/login/attiva-codice";

export async function consoleSignIn(
  supabase: PlatformDb,
  input: { email: string; password: string },
): Promise<{ redirect: ConsoleSignInRedirect }> {
  const { error } = await callAuth(
    supabase.auth.signInWithPassword({ email: input.email, password: input.password }),
  );
  if (error) {
    const outcome = classifySignIn(error);
    if (outcome === "invalid")
      throw new ApiError(401, "login_invalid", t("authError.login_invalid"));
    if (outcome === "rate_limited")
      throw new ApiError(429, "rate_limited", t("authError.rate_limited"));
    const { status, code } = toLogSafe(error);
    reportError(new Error(`console sign-in failed: ${status ?? "no status"} ${code ?? "no code"}`));
    throw new ApiError(502, "upstream_error", t("authError.upstream_error"));
  }

  const staff = await supabase.rpc("platform_mfa_attempt_allowed");
  if (staff.error) {
    await signOutQuietly(supabase);
    if (staff.error.code === "42501") {
      throw new ApiError(403, "not_console_account", "Questo account non ha accesso alla console.");
    }
    throw new Error(`platform_mfa_attempt_allowed failed: ${staff.error.code ?? "no code"}`);
  }

  const factors = await supabase.auth.mfa.listFactors();
  if (factors.error) {
    const { status, code } = toLogSafe(factors.error);
    reportError(
      new Error(`console factor list failed: ${status ?? "no status"} ${code ?? "no code"}`),
    );
    throw new ApiError(502, "upstream_error", t("authError.upstream_error"));
  }
  const verified = (factors.data?.totp ?? []).some((f) => f.status === "verified");
  return { redirect: verified ? "/login/codice" : "/login/attiva-codice" };
}

async function signOutQuietly(supabase: PlatformDb): Promise<void> {
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // The 403 still tells the person; the cookie dies with the next sign-in.
  }
}
