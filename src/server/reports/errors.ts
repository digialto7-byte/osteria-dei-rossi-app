import { ApiError, type ErrorCode } from "@/lib/api/errors";
import { t, type MessageKey } from "@/lib/i18n";
import type { DbError } from "@/server/master/db-errors";

type Coded = Extract<
  ErrorCode,
  | "range_invalid"
  | "range_too_long"
  | "date_in_future"
  | "avt_count_not_monthly"
  | "avt_count_not_closed"
  | "avt_no_opening_count"
>;

// The P0001 messages of the report functions (M22 plan §3.5): all of them are things the person can fix, so 422.
const PROCEDURE_ERRORS: readonly Coded[] = [
  "range_invalid",
  "range_too_long",
  "date_in_future",
  "avt_count_not_monthly",
  "avt_count_not_closed",
  "avt_no_opening_count",
];

/**
 * Turns a database error from kpi_report / kpi_items / avt_report / unmapped_items into an ApiError with a safe Italian message; the database
 * message is never sent. Anything unexpected is a plain Error that names only the SQLSTATE.
 */
export function mapReportDbError(error: DbError): ApiError | Error {
  switch (error.code) {
    case "42501":
      return new ApiError(403, "forbidden", t("reportError.forbidden"));
    case "22023":
      return new ApiError(400, "invalid_request", "Richiesta non valida.");
    case "P0002":
      if (error.message === "count_not_found") {
        return new ApiError(404, "not_found", t("reportError.count_not_found"));
      }
      break;
    case "P0001": {
      const code = PROCEDURE_ERRORS.find((c) => c === error.message);
      if (code) return new ApiError(422, code, t(`reportError.${code}` as MessageKey));
      break;
    }
  }
  return new Error(`Unexpected database error ${error.code ?? "(no code)"}`);
}
