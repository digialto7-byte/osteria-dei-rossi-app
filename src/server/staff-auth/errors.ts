import { ApiError, type ErrorCode } from "@/lib/api/errors";
import { t, type MessageKey } from "@/lib/i18n";
import type { DbError } from "@/server/master/db-errors";

/** Statuses of the login and enrolment procedures (and of the route steps around them) that are errors. */
type StatusCode = Extract<
  ErrorCode,
  | "device_missing"
  | "device_unknown"
  | "device_revoked"
  | "device_locked"
  | "user_locked"
  | "pin_invalid"
  | "attempt_in_progress"
  | "auth_rate_limited"
  | "upstream_error"
  | "session_ended"
  | "enrolment_code_invalid"
  | "enrolment_code_used"
  | "enrolment_code_expired"
  | "enrol_rate_limited"
>;

const STATUS_TABLE = {
  device_missing: [401, "device_missing"],
  device_unknown: [401, "device_unknown"],
  device_revoked: [401, "device_revoked"],
  device_locked: [423, "device_locked"],
  user_locked: [423, "user_locked"],
  pin_invalid: [401, "pin_invalid"],
  attempt_in_progress: [429, "attempt_in_progress"],
  auth_rate_limited: [429, "auth_rate_limited"],
  upstream_error: [502, "upstream_error"],
  session_ended: [401, "session_ended"],
  // redeem_enrolment_code
  code_invalid: [404, "enrolment_code_invalid"],
  code_used: [410, "enrolment_code_used"],
  code_expired: [410, "enrolment_code_expired"],
  rate_limited: [429, "enrol_rate_limited"],
} as const satisfies Record<string, readonly [number, StatusCode]>;

export type StaffAuthStatus = keyof typeof STATUS_TABLE;
export const STAFF_AUTH_STATUSES = Object.keys(STATUS_TABLE) as readonly StaffAuthStatus[];

const messageKey = (code: ErrorCode) => `staffAuthError.${code}` as MessageKey;

export interface StatusExtra {
  attemptsLeft?: number;
  lockedUntil?: string;
}

/**
 * The ApiError for a status that a login or enrolment procedure returned. `pin_invalid` carries
 * `attemptsLeft` and `user_locked` carries `lockedUntil` as details, so the screen can show them.
 */
export function mapStaffAuthStatus(status: StaffAuthStatus, extra: StatusExtra = {}): ApiError {
  if (!Object.hasOwn(STATUS_TABLE, status)) {
    throw new Error("Unknown staff auth status");
  }
  const [http, code] = STATUS_TABLE[status];
  let details: { attemptsLeft: number }[] | { lockedUntil: string }[] | undefined;
  if (status === "pin_invalid" && extra.attemptsLeft !== undefined) {
    details = [{ attemptsLeft: extra.attemptsLeft }];
  } else if (status === "user_locked" && extra.lockedUntil !== undefined) {
    details = [{ lockedUntil: extra.lockedUntil }];
  }
  return new ApiError(http, code, t(messageKey(code)), details);
}

type Coded = Extract<
  ErrorCode,
  | "label_invalid"
  | "display_name_invalid"
  | "staff_role_invalid"
  | "nothing_to_change"
  | "staff_inactive"
  | "staff_not_pin"
  | "device_revoked"
  | "auth_user_invalid"
>;

// P0001 messages of the M11 management procedures (migration 20261025100600).
const PROCEDURE_ERRORS: Record<Coded, number> = {
  label_invalid: 422,
  display_name_invalid: 422,
  staff_role_invalid: 422,
  nothing_to_change: 422,
  staff_inactive: 409,
  staff_not_pin: 409,
  device_revoked: 409,
  auth_user_invalid: 409,
};

/**
 * Turns a database error from the M11 procedures into an ApiError with a safe Italian message. The database
 * message is never sent. Anything unexpected is a plain Error that names only the SQLSTATE.
 */
export function mapStaffAuthDbError(error: DbError): ApiError | Error {
  switch (error.code) {
    case "42501":
      return new ApiError(403, "forbidden", "Operazione non consentita per il tuo ruolo.");
    case "P0002":
      return new ApiError(404, "not_found", "Risorsa non trovata.");
    case "P0001":
      if (Object.hasOwn(PROCEDURE_ERRORS, error.message)) {
        const code = error.message as Coded;
        return new ApiError(PROCEDURE_ERRORS[code], code, t(messageKey(code)));
      }
      break;
  }
  return new Error(`Unexpected database error ${error.code ?? "(no code)"}`);
}

/** The 422 for a PIN the policy refuses (pin-policy.ts); raised before anything else is called. */
export function pinTrivialError(): ApiError {
  return new ApiError(422, "pin_trivial", t(messageKey("pin_trivial")));
}
