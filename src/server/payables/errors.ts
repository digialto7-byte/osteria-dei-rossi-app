import { ApiError, type ErrorCode } from "@/lib/api/errors";
import { t } from "@/lib/i18n";
import type { DbError } from "@/server/master/db-errors";

type Coded = Extract<
  ErrorCode,
  | "payable_paid_locked"
  | "payable_not_paid"
  | "payable_transition_invalid"
  | "paid_on_required"
  | "paid_on_not_allowed"
  | "paid_on_future"
  | "reason_required"
  | "reversal_target_invalid"
>;

// public.set_payable_status raises P0001 with the code as the message (M9 plan §3.3).
const PROCEDURE_ERRORS: Record<Coded, number> = {
  payable_paid_locked: 409,
  payable_not_paid: 409,
  payable_transition_invalid: 409,
  paid_on_required: 422,
  paid_on_not_allowed: 422,
  paid_on_future: 422,
  reason_required: 422,
  reversal_target_invalid: 422,
};

/**
 * Turns a database error from the payables functions into an ApiError with a safe Italian message.
 * The database message is never sent (it could carry a reason typed by the owner). Anything
 * unexpected is a plain Error that names only the SQLSTATE, for the 500 handler and Sentry.
 */
export function mapPayableDbError(error: DbError): ApiError | Error {
  switch (error.code) {
    case "42501":
      return new ApiError(403, "forbidden", "Operazione non consentita per il tuo ruolo.");
    case "P0002":
      return new ApiError(404, "not_found", "Risorsa non trovata.");
    case "P0001":
      if (error.message === "invalid_request") {
        return new ApiError(400, "invalid_request", "Richiesta non valida.");
      }
      if (Object.hasOwn(PROCEDURE_ERRORS, error.message)) {
        const code = error.message as Coded;
        return new ApiError(PROCEDURE_ERRORS[code], code, t(`payableError.${code}`));
      }
      break;
  }
  return new Error(`Unexpected database error ${error.code ?? "(no code)"}`);
}
