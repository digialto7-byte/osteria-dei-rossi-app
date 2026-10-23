import { ApiError, type ErrorCode } from "@/lib/api/errors";
import { t, type MessageKey } from "@/lib/i18n";
import type { DbError } from "@/server/master/db-errors";

type Coded = Extract<
  ErrorCode,
  | "lot_empty"
  | "insufficient_stock"
  | "already_reversed"
  | "movement_is_reversal"
  | "movement_not_reversible"
  | "transfer_already_used"
  | "reason_invalid"
  | "unit_mismatch"
  | "qty_invalid"
  | "ingredient_not_stock"
  | "same_location"
  | "location_required"
  | "no_location"
  | "location_not_found"
  | "range_invalid"
  | "range_too_long"
>;

// The P0001 messages of the stock functions (M12 plan §3.4): code -> HTTP status.
const PROCEDURE_ERRORS: Record<Coded, number> = {
  lot_empty: 409,
  insufficient_stock: 409,
  already_reversed: 409,
  movement_is_reversal: 409,
  movement_not_reversible: 409,
  transfer_already_used: 409,
  reason_invalid: 422,
  unit_mismatch: 422,
  qty_invalid: 422,
  ingredient_not_stock: 422,
  same_location: 422,
  location_required: 422,
  no_location: 422,
  location_not_found: 422,
  range_invalid: 422,
  range_too_long: 422,
};

// P0002 messages: what was not found. Always a 404 not_found; the text only names the kind of record.
const NOT_FOUND: Record<string, MessageKey> = {
  ingredient_not_found: "stockError.ingredient_not_found",
  lot_not_found: "stockError.lot_not_found",
  movement_not_found: "stockError.movement_not_found",
  location_not_found: "stockError.location_not_found",
};

/**
 * Turns a database error from the stock functions into an ApiError with a safe Italian message. The database
 * message is never sent. Anything unexpected is a plain Error that names only the SQLSTATE (no quantity, name or
 * id), for the 500 handler and Sentry.
 */
export function mapStockDbError(error: DbError): ApiError | Error {
  switch (error.code) {
    case "42501":
      return new ApiError(403, "forbidden", "Operazione non consentita per il tuo ruolo.");
    case "P0002": {
      const key = NOT_FOUND[error.message] ?? "stockError.not_found";
      return new ApiError(404, "not_found", t(key));
    }
    case "23505":
      if (error.message.includes("stock_movement_reverses_uq")) {
        return new ApiError(409, "already_reversed", t("stockError.already_reversed"));
      }
      break;
    case "P0001":
      if (error.message === "invalid_request") {
        return new ApiError(400, "invalid_request", "Richiesta non valida.");
      }
      if (Object.hasOwn(PROCEDURE_ERRORS, error.message)) {
        const code = error.message as Coded;
        return new ApiError(PROCEDURE_ERRORS[code], code, t(`stockError.${code}`));
      }
      break;
  }
  return new Error(`Unexpected database error ${error.code ?? "(no code)"}`);
}
