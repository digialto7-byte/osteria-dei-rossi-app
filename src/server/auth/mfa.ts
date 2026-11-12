import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/errors";
import { toLogSafe } from "@/lib/auth/auth-errors";
import { MFA_MAX_FACTORS, slotOfFriendlyName, type MfaSlot } from "@/lib/auth/mfa-constants";
import { t } from "@/lib/i18n";
import { reportError } from "@/lib/observability/report";
import { redirectAfterSignIn } from "@/server/auth/redirect";
import {
  accountsOutput,
  dbAttempt,
  dbEnrolCheck,
  dbStatus,
  type MfaStatus,
} from "@/server/auth/mfa-schemas";

// P2-1 (docs/plans/2026-11-12-p2-1-totp.md sections 3.4 to 3.6): the second-factor calls of the signed-in owner or admin. The authenticator secrets are kept by
// Supabase Auth, never by the app: the secret and the QR image pass through here ONCE, in the reply of the enrolment, and are never stored, logged or put in an
// error. Codes are checked by Supabase in one request (challengeAndVerify), so the challenge and the verify leave from the same invocation (T-6). Nothing here
// logs a body, a code, a secret, a QR or a URI: reports carry the operation, the HTTP status and the Auth error code only.

const SVG_URL_PREFIX = "data:image/svg+xml;utf-8,";
/** An optional XML declaration, then comments and white space, at the very start. */
const SVG_PROLOG = /^\s*(?:<\?xml[^>]*\?>)?(?:\s*<!--[\s\S]*?-->)*\s*/;
const TOO_MANY_REQUESTS = 429;
const MS_PER_SECOND = 1000;

type DbError = { code?: string; message?: string };

/** Reports an unexpected failure by name, status and code only. */
function report(operation: string, error: unknown): void {
  const { status, code } = toLogSafe(error);
  reportError(new Error(`${operation} failed: status=${status ?? "none"} code=${code ?? "none"}`));
}

/** A Postgres error of the MFA procedures as the API error the screens know; anything else is an internal error carrying the SQLSTATE only. */
function mapDbError(operation: string, error: DbError): never {
  const message = error.message ?? "";
  if (error.code === "P0001") {
    switch (message) {
      case "mfa_required":
        throw new ApiError(403, "mfa_required", t("authError.mfa_required"));
      case "mfa_factor_limit":
        throw new ApiError(409, "mfa_factor_limit", t("authError.mfa_factor_limit"));
      case "mfa_slot_taken":
        throw new ApiError(409, "mfa_slot_taken", t("authError.mfa_slot_taken"));
      case "mfa_last_factor":
        throw new ApiError(409, "mfa_last_factor", t("authError.mfa_last_factor"));
      case "mfa_factor_not_found":
        throw new ApiError(404, "not_found", "Risorsa non trovata.");
    }
  }
  if (error.code === "42501") {
    throw new ApiError(403, "forbidden", "Operazione non consentita per il tuo ruolo.");
  }
  if (error.code === "22023") {
    throw new ApiError(400, "invalid_request", "Richiesta non valida.");
  }
  throw new Error(`${operation} failed: ${error.code ?? "no code"}`);
}

async function rpc(
  supabase: SupabaseClient,
  name: string,
  args?: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await (args === undefined
    ? supabase.rpc(name)
    : supabase.rpc(name, args));
  if (error) mapDbError(name, error);
  return data;
}

/** Calls a recording procedure after the Auth change succeeded. A failure is reported and never hides the outcome: the record functions are idempotent. */
async function recordQuietly(
  supabase: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.rpc(name, args);
  if (error) reportError(new Error(`${name} failed: ${error.code ?? "no code"}`));
}

const upstream = () => new ApiError(502, "upstream_error", t("authError.upstream_error"));
const rateLimited = () => new ApiError(429, "rate_limited", t("authError.rate_limited"));
const notFound = () => new ApiError(404, "not_found", "Risorsa non trovata.");

/** A Supabase Auth error of an MFA call as the API error; reported by status and code only. */
function authFailure(operation: string, error: unknown): ApiError {
  const { status, code } = toLogSafe(error);
  if (status === TOO_MANY_REQUESTS || code === "over_request_rate_limit") return rateLimited();
  report(operation, error);
  return upstream();
}

interface FactorRow {
  id: string;
  friendly_name?: string | null;
  factor_type: string;
  status: string;
  created_at: string;
}

/** The caller's TOTP factors, verified and not. */
async function totpFactors(supabase: SupabaseClient): Promise<FactorRow[]> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw authFailure("mfa.listFactors", error);
  return (data?.all ?? []).filter((f) => f.factor_type === "totp") as FactorRow[];
}

const factorView = (f: FactorRow) => ({
  id: f.id,
  slot: slotOfFriendlyName(f.friendly_name),
  status: f.status === "verified" ? ("verified" as const) : ("unverified" as const),
  createdAt: new Date(f.created_at).toISOString(),
});

/** The account's own state for the screens (GET /api/me/mfa). The lock comes from Postgres, never from arithmetic in a component. */
export async function getMfaStatus(supabase: SupabaseClient): Promise<MfaStatus> {
  const state = dbStatus.parse(await rpc(supabase, "mfa_status"));
  const attempt = dbAttempt.parse(await rpc(supabase, "mfa_attempt_allowed"));
  const factors = (await totpFactors(supabase)).map(factorView);
  const level = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const currentLevel = level.data?.currentLevel === "aal2" ? "aal2" : "aal1";
  const verified = factors.filter((f) => f.status === "verified").length;
  return {
    role: state.role,
    mode: state.mode,
    gate: state.gate,
    currentLevel,
    factors,
    // Adding a factor to an account that already has one needs aal2 (Supabase and mfa_enrol_check agree).
    canAddFactor: verified < MFA_MAX_FACTORS && (verified === 0 || currentLevel === "aal2"),
    lockedUntil: attempt.allowed
      ? null
      : new Date(Date.now() + attempt.retryAfterSeconds * MS_PER_SECOND).toISOString(),
  };
}

/**
 * The image of the QR code from Supabase, as a data URL; null unless it is an SVG without a script.
 * supabase-js already prefixes the SVG with `data:image/svg+xml;utf-8,` (unencoded); the prefix is
 * removed, and so is the prolog the Auth server writes before `<svg` (an XML declaration and
 * comments, nothing else); the SVG is checked, then re-encoded.
 */
function safeQrImage(image: unknown): string | null {
  if (typeof image !== "string") return null;
  const body = image.startsWith(SVG_URL_PREFIX) ? image.slice(SVG_URL_PREFIX.length) : image;
  const svg = body.replace(SVG_PROLOG, "");
  if (!svg.startsWith("<svg") || /<script/i.test(svg)) return null;
  return `${SVG_URL_PREFIX}${encodeURIComponent(svg)}`;
}

/** First step of the enrolment: check in Postgres, clear the account's own unverified factors, enrol a new one. */
export async function startEnrolment(supabase: SupabaseClient, slot: MfaSlot) {
  const check = dbEnrolCheck.parse(await rpc(supabase, "mfa_enrol_check", { p_slot: slot }));
  for (const old of (await totpFactors(supabase)).filter((f) => f.status !== "verified")) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId: old.id });
    if (error) throw authFailure("mfa.unenroll", error);
  }
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: check.friendlyName,
    issuer: check.issuer,
  });
  if (error || !data) throw authFailure("mfa.enroll", error);
  const qrImage = safeQrImage(data.totp?.qr_code);
  if (qrImage === null || !data.totp.secret) {
    // Nothing is returned, and the half-made factor is removed (best effort: an unverified factor is also cleared by the next attempt).
    await supabase.auth.mfa.unenroll({ factorId: data.id }).catch(() => undefined);
    report("mfa.enroll(unexpected image)", { status: 200, code: "bad_qr" });
    throw upstream();
  }
  return { factorId: data.id, slot, qrImage, secret: data.totp.secret };
}

/** The answer of Postgres for the lock: 429 before any Auth call. */
async function assertAttemptAllowed(supabase: SupabaseClient): Promise<void> {
  const attempt = dbAttempt.parse(await rpc(supabase, "mfa_attempt_allowed"));
  if (!attempt.allowed) {
    throw new ApiError(429, "mfa_locked", t("authError.mfa_locked"), {
      retryAfterSeconds: attempt.retryAfterSeconds,
    });
  }
}

/** Checks a code in one request; a wrong one is recorded for the lock and answered 422 (never 401: the client reads 401 as a lost session). */
async function checkCode(
  supabase: SupabaseClient,
  factorId: string,
  code: string,
  stage: "login" | "enrol",
): Promise<void> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (!error) return;
  const { status, code: authCode } = toLogSafe(error);
  if (status === TOO_MANY_REQUESTS || authCode === "over_request_rate_limit") throw rateLimited();
  if (authCode === "mfa_verification_failed") {
    await recordQuietly(supabase, "mfa_record_failure", { p_stage: stage });
    throw new ApiError(422, "mfa_code_invalid", t("authError.mfa_code_invalid"));
  }
  if (authCode === "mfa_challenge_expired") {
    throw new ApiError(422, "mfa_challenge_expired", t("authError.mfa_challenge_expired"));
  }
  if (authCode === "mfa_factor_not_found") throw notFound();
  report("mfa.challengeAndVerify", error);
  throw upstream();
}

/** Last step of the enrolment: the code from the new authenticator. The session becomes aal2 (Supabase rewrites the cookies). */
export async function verifyEnrolment(supabase: SupabaseClient, factorId: string, code: string) {
  await assertAttemptAllowed(supabase);
  await checkCode(supabase, factorId, code, "enrol");
  await recordQuietly(supabase, "mfa_record_enrolled", { p_factor: factorId });
  let factor = {
    id: factorId,
    slot: "altro" as MfaSlot | "altro",
    status: "verified" as const,
    createdAt: new Date().toISOString(),
  };
  try {
    const found = (await totpFactors(supabase)).find((f) => f.id === factorId);
    if (found) factor = { ...factorView(found), status: "verified" };
  } catch {
    // The factor is enrolled; the list is a convenience for the screen and a failure is already reported.
  }
  return { factor, currentLevel: "aal2" as const };
}

/** The sign-in challenge: the code from the authenticator after the password or e-mail code. */
export async function challengeSignIn(
  supabase: SupabaseClient,
  session: { tenantId: string; role: string },
  body: { factorId: string; code: string; next?: string },
) {
  await assertAttemptAllowed(supabase);
  await checkCode(supabase, body.factorId, body.code, "login");
  return {
    redirect: redirectAfterSignIn(
      { tenant_id: session.tenantId, app_role: session.role },
      body.next,
    ),
  };
}

/** Removes one of the account's own factors. Postgres decides first (aal2, last factor of an admin under required), then Supabase, then the audit row. */
export async function removeFactor(supabase: SupabaseClient, factorId: string) {
  await rpc(supabase, "mfa_unenrol_check", { p_factor: factorId });
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw authFailure("mfa.unenroll", error);
  await recordQuietly(supabase, "mfa_record_unenrolled", { p_factor: factorId });
  return { removed: true as const };
}

/** The other owner and admin accounts of the venue: counts only, read-only (no reset exists in the app, founder decision Q-T1 = V1). */
export async function listAccounts(supabase: SupabaseClient) {
  const rows = await rpc(supabase, "mfa_accounts");
  return accountsOutput.parse({ accounts: rows });
}
