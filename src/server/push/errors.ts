import { ApiError, type ErrorCode } from "@/lib/api/errors";
import { t, type MessageKey } from "@/lib/i18n";
import type { DbError } from "@/server/master/db-errors";

type Coded = Extract<
  ErrorCode,
  | "menu_item_inactive"
  | "push_price_invalid"
  | "push_price_above_menu"
  | "date_out_of_range"
  | "date_in_future"
>;

// The P0001 messages of push_menu_item, forecast and discards_vs_push (M23 plan §3.4): code -> HTTP status. An inactive item is a conflict with the
// item's state (409); the rest are values the caller can fix (422).
const PROCEDURE_ERRORS: Record<Coded, number> = {
  menu_item_inactive: 409,
  push_price_invalid: 422,
  push_price_above_menu: 422,
  date_out_of_range: 422,
  date_in_future: 422,
};

/**
 * Turns a database error from the M23 functions into an ApiError with a safe Italian message. The database message is never sent. Anything
 * unexpected is a plain Error that names only the SQLSTATE, for the 500 handler.
 */
export function mapPushDbError(error: DbError): ApiError | Error {
  switch (error.code) {
    case "42501":
      return new ApiError(403, "forbidden", t("pushError.forbidden"));
    case "22023":
      return new ApiError(400, "invalid_request", "Richiesta non valida.");
    case "P0002":
      if (error.message === "menu_item_not_found") {
        return new ApiError(404, "not_found", t("pushError.menu_item_not_found"));
      }
      break;
    case "P0001":
      if (Object.hasOwn(PROCEDURE_ERRORS, error.message)) {
        const code = error.message as Coded;
        return new ApiError(PROCEDURE_ERRORS[code], code, t(`pushError.${code}` as MessageKey));
      }
      break;
  }
  return new Error(`Unexpected database error ${error.code ?? "(no code)"}`);
}
