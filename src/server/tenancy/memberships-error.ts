import { ApiError } from "@/lib/api/errors";
import { t } from "@/lib/i18n";

/**
 * The error of a public.my_memberships call as the caller sees it. SP3 step 15 (plan §3.3.5): the platform admin's list needs aal2, so P0001
 * mfa_required is 403 mfa_required (the client goes to the code page). Anything else is reported with its code only (never a message, which could
 * name a tenant).
 */
export function membershipsError(error: { code?: string; message?: string }): Error {
  if (error.code === "P0001" && error.message === "mfa_required") {
    return new ApiError(403, "mfa_required", t("authError.mfa_required"));
  }
  return new Error(`my_memberships failed: ${error.code ?? "no code"}`);
}
