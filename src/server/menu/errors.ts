import { ApiError, type ErrorCode } from "@/lib/api/errors";
import { t, type MessageKey } from "@/lib/i18n";
import type { DbError } from "@/server/master/db-errors";

type Coded = Extract<
  ErrorCode,
  | "menu_item_name_taken"
  | "recipe_already_on_menu"
  | "recipe_not_plate"
  | "recipe_inactive"
  | "price_invalid"
  | "vat_rate_invalid"
  | "position_invalid"
  | "name_invalid"
  | "category_invalid"
>;

// The P0001 messages of the menu procedures (M17 plan §3.4): code -> HTTP status. Name and recipe clashes are
// conflicts with existing rows (409); the rest are values the caller can fix (422).
const PROCEDURE_ERRORS: Record<Coded, number> = {
  menu_item_name_taken: 409,
  recipe_already_on_menu: 409,
  recipe_not_plate: 422,
  recipe_inactive: 422,
  price_invalid: 422,
  vat_rate_invalid: 422,
  position_invalid: 422,
  name_invalid: 422,
  category_invalid: 422,
};

// P0002 messages: what was not found. Always a 404 not_found; the text only names the kind of record.
const NOT_FOUND: Record<string, MessageKey> = {
  menu_item_not_found: "menuError.menu_item_not_found",
  recipe_not_found: "menuError.recipe_not_found",
};

/**
 * Turns a database error from the menu functions into an ApiError with a safe Italian message. The database
 * message is never sent. Anything unexpected is a plain Error that names only the SQLSTATE, for the 500 handler.
 */
export function mapMenuDbError(error: DbError): ApiError | Error {
  switch (error.code) {
    case "42501":
      return new ApiError(403, "forbidden", "Operazione non consentita per il tuo ruolo.");
    case "22023":
      return new ApiError(400, "invalid_request", "Richiesta non valida.");
    case "P0002": {
      const key = Object.hasOwn(NOT_FOUND, error.message)
        ? NOT_FOUND[error.message]!
        : "menuError.menu_item_not_found";
      return new ApiError(404, "not_found", t(key));
    }
    case "P0001":
      if (Object.hasOwn(PROCEDURE_ERRORS, error.message)) {
        const code = error.message as Coded;
        return new ApiError(PROCEDURE_ERRORS[code], code, t(`menuError.${code}` as MessageKey));
      }
      break;
  }
  return new Error(`Unexpected database error ${error.code ?? "(no code)"}`);
}
