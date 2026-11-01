import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { classifySignIn, classifyUpdate, toLogSafe } from "@/lib/auth/auth-errors";
import {
  checkNewPassword,
  PASSWORD_MIN_LENGTH,
  passwordRejectionKey,
} from "@/lib/auth/password-policy";
import {
  isRecentSignIn,
  lastAuthAt,
  RECENT_SIGN_IN_MINUTES,
  signInMethod,
} from "@/lib/auth/session-age";
import { t } from "@/lib/i18n";
import { reportError } from "@/lib/observability/report";
import { createVerifierClient } from "@/lib/supabase/verifier";
import { callAuth } from "./auth-call";
import type { PasswordStatus } from "./schemas";

const authClaims = z.object({
  email: z.string().optional(),
  login: z.string().optional(),
  amr: z.array(z.object({ method: z.string(), timestamp: z.number() })).optional(),
});

interface Who {
  email: string | undefined;
  amr: { method: string; timestamp: number }[] | undefined;
}

/** Reads the claims of the current token. A PIN session never reaches the password routes (403). */
async function whoIsAsking(supabase: SupabaseClient): Promise<Who> {
  const { data } = await supabase.auth.getClaims();
  const parsed = authClaims.safeParse(data?.claims);
  const forbidden = new ApiError(403, "forbidden", t("password.forbidden"));
  if (!parsed.success || parsed.data.login === "pin") throw forbidden;
  return { email: parsed.data.email, amr: parsed.data.amr };
}

/** How the person signed in and whether the last sign-in is recent, from the token alone (no RPC). */
export async function passwordStatus(supabase: SupabaseClient): Promise<PasswordStatus> {
  const { amr } = await whoIsAsking(supabase);
  const claims = { amr };
  const now = Date.now();
  const recent = isRecentSignIn(claims, now);
  const last = lastAuthAt(claims);
  return {
    signInMethod: signInMethod(claims),
    recentSignIn: recent,
    recentUntil:
      recent && last !== null
        ? new Date((last + RECENT_SIGN_IN_MINUTES * 60) * 1000).toISOString()
        : null,
    minLength: PASSWORD_MIN_LENGTH,
  };
}

async function verifyCurrentPassword(email: string, currentPassword: string): Promise<void> {
  const verifier = createVerifierClient();
  const { error } = await callAuth(
    verifier.auth.signInWithPassword({ email, password: currentPassword }),
  );
  if (error) {
    const outcome = classifySignIn(error);
    if (outcome === "invalid") {
      // 422, not 401: the client treats 401 as a lost session.
      throw new ApiError(422, "current_password_invalid", t("authError.current_password_invalid"));
    }
    if (outcome === "rate_limited") {
      throw new ApiError(429, "rate_limited", t("authError.rate_limited"));
    }
    throw new ApiError(502, "upstream_error", t("authError.upstream_error"));
  }
  // The throwaway session lives in memory only and dies with this request, so a failure here is reported but
  // does not change the outcome.
  try {
    const ended = await callAuth(verifier.auth.signOut({ scope: "local" }));
    if (ended.error) reportCode("verifier sign-out failed", ended.error);
  } catch {
    reportError(new Error("verifier sign-out failed: request"));
  }
}

function reportCode(what: string, error: unknown): void {
  const { status, code } = toLogSafe(error);
  reportError(new Error(`${what}: ${status ?? "no status"} ${code ?? "no code"}`));
}

/**
 * Sets or changes the password of the signed-in owner or admin (ADR-029 decision 3), in this order: policy, current
 * password (unless the sign-in is recent), update, sign in again here, end every other session.
 */
export async function changePassword(
  supabase: SupabaseClient,
  input: { newPassword: string; currentPassword?: string },
): Promise<{ status: "saved" }> {
  const { email, amr } = await whoIsAsking(supabase);
  if (!email) throw new ApiError(403, "forbidden", t("password.forbidden"));

  const verdict = checkNewPassword(input.newPassword, { email });
  if (!verdict.ok) {
    throw new ApiError(422, "password_weak", t(passwordRejectionKey(verdict.reason)), {
      reason: verdict.reason,
    });
  }

  if (!isRecentSignIn({ amr }, Date.now())) {
    if (!input.currentPassword) {
      throw new ApiError(
        422,
        "current_password_required",
        t("authError.current_password_required"),
      );
    }
    await verifyCurrentPassword(email, input.currentPassword);
  }

  const { error } = await callAuth(supabase.auth.updateUser({ password: input.newPassword }));
  if (error) {
    const outcome = classifyUpdate(error);
    if (outcome === "weak") {
      throw new ApiError(422, "password_weak", t("authError.password_weak"));
    }
    if (outcome === "same") {
      throw new ApiError(422, "password_same", t("authError.password_same"));
    }
    if (outcome === "rate_limited") {
      throw new ApiError(429, "rate_limited", t("authError.rate_limited"));
    }
    reportCode("password update failed", error);
    throw new ApiError(502, "upstream_error", t("authError.upstream_error"));
  }

  // The password is saved. From here a failure is reported but does not undo it.
  // This device becomes a fresh password session (the 30 days restart); every other one ends.
  try {
    const signedIn = await callAuth(
      supabase.auth.signInWithPassword({ email, password: input.newPassword }),
    );
    if (signedIn.error) reportCode("re-sign-in after password change failed", signedIn.error);
  } catch {
    reportError(new Error("re-sign-in after password change failed: request"));
  }
  try {
    const others = await callAuth(supabase.auth.signOut({ scope: "others" }));
    if (others.error) reportCode("ending other sessions failed", others.error);
  } catch {
    reportError(new Error("ending other sessions failed: request"));
  }
  return { status: "saved" };
}
