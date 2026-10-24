import { ApiError, type ErrorCode } from "@/lib/api/errors";
import { t, type MessageKey } from "@/lib/i18n";
import type { DbError } from "@/server/master/db-errors";

type Coded = Extract<
  ErrorCode,
  | "count_closed"
  | "count_cancelled"
  | "count_open_exists"
  | "count_not_closed"
  | "count_empty"
  | "no_critical_ingredients"
  | "duplicate_line"
  | "type_invalid"
  | "qty_invalid"
  | "unit_mismatch"
  | "ingredient_not_stock"
  | "location_required"
  | "no_location"
  | "location_not_found"
  | "range_invalid"
  | "range_too_long"
>;

// The P0001 messages of the count functions (M13 plan §3.4): code -> HTTP status.
const PROCEDURE_ERRORS: Record<Coded, number> = {
  count_closed: 409,
  count_cancelled: 409,
  count_open_exists: 409,
  count_not_closed: 409,
  count_empty: 422,
  no_critical_ingredients: 422,
  duplicate_line: 422,
  type_invalid: 422,
  qty_invalid: 422,
  unit_mismatch: 422,
  ingredient_not_stock: 422,
  location_required: 422,
  no_location: 422,
  location_not_found: 422,
  range_invalid: 422,
  range_too_long: 422,
};

// The text of each code: the count codes have their own, the ones shared with the stock functions reuse theirs.
const MESSAGE: Record<Coded, MessageKey> = {
  count_closed: "countError.count_closed",
  count_cancelled: "countError.count_cancelled",
  count_open_exists: "countError.count_open_exists",
  count_not_closed: "countError.count_not_closed",
  count_empty: "countError.count_empty",
  no_critical_ingredients: "countError.no_critical_ingredients",
  duplicate_line: "countError.duplicate_line",
  type_invalid: "countError.type_invalid",
  qty_invalid: "stockError.qty_invalid",
  unit_mismatch: "stockError.unit_mismatch",
  ingredient_not_stock: "stockError.ingredient_not_stock",
  location_required: "stockError.location_required",
  no_location: "stockError.no_location",
  location_not_found: "stockError.location_not_found",
  range_invalid: "stockError.range_invalid",
  range_too_long: "stockError.range_too_long",
};

// P0002 messages: what was not found. Always a 404 not_found; the text only names the kind of record.
const NOT_FOUND: Record<string, MessageKey> = {
  count_not_found: "countError.count_not_found",
  count_line_not_found: "countError.count_line_not_found",
  ingredient_not_found: "stockError.ingredient_not_found",
  location_not_found: "stockError.location_not_found",
};

/**
 * Turns a database error from the count functions into an ApiError with a safe Italian message. The database
 * message is never sent. Anything unexpected is a plain Error that names only the SQLSTATE (no quantity, name or
 * id), for the 500 handler and Sentry.
 */
export function mapCountDbError(error: DbError): ApiError | Error {
  switch (error.code) {
    case "42501":
      return new ApiError(403, "forbidden", "Operazione non consentita per il tuo ruolo.");
    case "22023":
      return new ApiError(400, "invalid_request", "Richiesta non valida.");
    case "P0002": {
      const key = NOT_FOUND[error.message] ?? "stockError.not_found";
      return new ApiError(404, "not_found", t(key));
    }
    case "P0001":
      if (Object.hasOwn(PROCEDURE_ERRORS, error.message)) {
        const code = error.message as Coded;
        return new ApiError(PROCEDURE_ERRORS[code], code, t(MESSAGE[code]));
      }
      break;
  }
  return new Error(`Unexpected database error ${error.code ?? "(no code)"}`);
}
