import { ApiError, type ErrorCode } from "@/lib/api/errors";
import { t, type MessageKey } from "@/lib/i18n";
import type { DbError } from "@/server/master/db-errors";

type Coded = Extract<
  ErrorCode,
  | "staff_meal_already_confirmed"
  | "staff_meal_rule_inactive"
  | "rules_limit"
  | "portions_insufficient"
  | "count_invalid"
  | "staff_meal_target_invalid"
  | "unit_mismatch"
  | "location_not_found"
  | "location_required"
  | "no_location"
>;

// The P0001 messages of the staff-meal functions (M15 plan §3.4): code -> HTTP status.
const PROCEDURE_ERRORS: Record<Coded, number> = {
  staff_meal_already_confirmed: 409,
  staff_meal_rule_inactive: 409,
  rules_limit: 409,
  portions_insufficient: 409,
  count_invalid: 422,
  staff_meal_target_invalid: 422,
  unit_mismatch: 422,
  location_not_found: 422,
  location_required: 422,
  no_location: 422,
};

// The codes the stock functions raise too keep the text of the stock screens.
const STOCK_TEXT = new Set<Coded>([
  "unit_mismatch",
  "location_not_found",
  "location_required",
  "no_location",
]);

const NOT_FOUND: Record<string, MessageKey> = {
  staff_meal_rule_not_found: "staffMealError.staff_meal_rule_not_found",
};

/**
 * Turns a database error from the staff-meal functions into an ApiError with a safe Italian message. The database
 * message is never sent. Anything unexpected is a plain Error that names only the SQLSTATE.
 */
export function mapStaffMealDbError(error: DbError): ApiError | Error {
  switch (error.code) {
    case "42501":
      return new ApiError(403, "forbidden", "Operazione non consentita per il tuo ruolo.");
    case "P0002": {
      const key = Object.hasOwn(NOT_FOUND, error.message)
        ? NOT_FOUND[error.message]!
        : "stockError.not_found";
      return new ApiError(404, "not_found", t(key));
    }
    case "23505":
      // The second of two concurrent confirmations: the unique day key is the guard (plan §3.1.7).
      if (error.message.includes("staff_meal_confirmation_day_uq")) {
        return new ApiError(
          409,
          "staff_meal_already_confirmed",
          t("staffMealError.staff_meal_already_confirmed"),
        );
      }
      break;
    case "P0001":
      if (error.message === "invalid_request") {
        return new ApiError(400, "invalid_request", "Richiesta non valida.");
      }
      if (Object.hasOwn(PROCEDURE_ERRORS, error.message)) {
        const code = error.message as Coded;
        const key = (
          STOCK_TEXT.has(code) ? `stockError.${code}` : `staffMealError.${code}`
        ) as MessageKey;
        return new ApiError(PROCEDURE_ERRORS[code], code, t(key));
      }
      break;
  }
  return new Error(`Unexpected database error ${error.code ?? "(no code)"}`);
}
