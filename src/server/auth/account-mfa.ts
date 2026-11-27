import type { SupabaseClient } from "@supabase/supabase-js";
import { safeNextPath } from "@/lib/api/safe-next";
import { MFA_MAX_FACTORS } from "@/lib/auth/mfa-constants";
import {
  assertAttemptAllowed,
  checkCode,
  factorView,
  startEnrolment,
  totpFactors,
  verifyEnrolment,
  type MfaProcedures,
} from "@/server/auth/mfa";
import { dbAttempt } from "@/server/auth/mfa-schemas";
import { ApiError } from "@/lib/api/errors";
import type { MfaSlot } from "@/lib/auth/mfa-constants";

// SP3 step 9 (docs/plans/2026-11-15-sp3-console.md sections 3.4.3, 3.6): the second factor of platform staff, who have no venue membership (the platform admin signs in on the
// console host, and on the app host before it picks a venue). The checks are the owner's and admin's: Postgres decides first (the lock, then the slot, limit and aal2
// rules), Supabase Auth checks the code in one request, a wrong code is recorded for the lock. What differs is who is asked: the platform_mfa_* procedures answer for an
// active platform.staff row, with or without a tenant claim, and refuse everyone else with 42501 (403 forbidden). The setup key and the QR image pass through here once, in
// the reply of the enrolment, exactly as for the venue's routes (the shared code in src/server/auth/mfa.ts); nothing here logs a code, a key or a body.

const PLATFORM_PROCEDURES: MfaProcedures = {
  attempt: "platform_mfa_attempt_allowed",
  failure: "platform_mfa_record_failure",
  enrolled: "platform_mfa_record_enrolled",
  // Staff only, whatever claims the token carries, and always the platform issuer (a venue owner or admin is refused; the venue's check would pass them).
  enrolCheck: "platform_mfa_enrol_check",
};
const MS_PER_SECOND = 1000;

/** The staff member's own factors, level and lock for the code and enrolment pages (GET /api/auth/mfa/account). The lock comes from Postgres. */
export async function getAccountMfa(supabase: SupabaseClient) {
  // The lock check is also the staff check: a caller that is not active platform staff is refused here (42501, 403 forbidden) before any Auth call.
  const attempt = await attemptOf(supabase);
  const factors = (await totpFactors(supabase)).map(factorView).map(({ id, slot, status }) => ({
    id,
    slot,
    status,
  }));
  const level = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const currentLevel = level.data?.currentLevel === "aal2" ? "aal2" : "aal1";
  const verified = factors.filter((f) => f.status === "verified").length;
  return {
    factors,
    currentLevel,
    // Adding a factor to an account that already has one needs aal2 (Supabase and mfa_enrol_check agree).
    canAddFactor: verified < MFA_MAX_FACTORS && (verified === 0 || currentLevel === "aal2"),
    lockedUntil: attempt.allowed
      ? null
      : new Date(Date.now() + attempt.retryAfterSeconds * MS_PER_SECOND).toISOString(),
  } as const;
}

async function attemptOf(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc(PLATFORM_PROCEDURES.attempt);
  if (error) {
    if (error.code === "42501")
      throw new ApiError(403, "forbidden", "Operazione non consentita per il tuo ruolo.");
    throw new Error(`${PLATFORM_PROCEDURES.attempt} failed: ${error.code ?? "no code"}`);
  }
  return dbAttempt.parse(data);
}

/** First step of the enrolment: platform_mfa_enrol_check (staff only, issuer "Costì"), then the same Supabase steps as the venue's enrolment. */
export function startAccountEnrolment(supabase: SupabaseClient, slot: MfaSlot) {
  return startEnrolment(supabase, slot, PLATFORM_PROCEDURES);
}

/** Last step of the enrolment: the lock, one challengeAndVerify, the platform audit row platform_admin.factor_enrolled. The session becomes aal2. */
export function verifyAccountEnrolment(supabase: SupabaseClient, factorId: string, code: string) {
  return verifyEnrolment(supabase, factorId, code, PLATFORM_PROCEDURES);
}

/** The sign-in code of a staff member: the lock, one challengeAndVerify, a wrong code recorded. The redirect is the safe `next`, else `/`. */
export async function challengeAccount(
  supabase: SupabaseClient,
  body: { factorId: string; code: string; next?: string },
) {
  await assertAttemptAllowed(supabase, PLATFORM_PROCEDURES);
  await checkCode(supabase, body.factorId, body.code, "login", PLATFORM_PROCEDURES);
  return { redirect: safeNextPath(body.next) };
}
