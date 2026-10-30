import { ApiError } from "@/lib/api/errors";
import { t } from "@/lib/i18n";
import type { DbError } from "@/server/master/db-errors";

/**
 * Turns a database error from enter_day_close / app_vs_register into an ApiError with a safe Italian message (M21 plan §3.5). The
 * database message is never sent. Anything unexpected is a plain Error that names only the SQLSTATE.
 */
export function mapDayCloseDbError(error: DbError): ApiError | Error {
  switch (error.code) {
    case "42501":
      return new ApiError(403, "forbidden", t("dayCloseError.forbidden"));
    case "22023":
      return new ApiError(400, "invalid_request", "Richiesta non valida.");
    case "P0001":
      if (error.message === "register_total_invalid" || error.message === "business_date_invalid") {
        return new ApiError(422, error.message, t(`dayCloseError.${error.message}`));
      }
      break;
  }
  return new Error(`Unexpected database error ${error.code ?? "(no code)"}`);
}
