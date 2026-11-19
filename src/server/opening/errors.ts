import { ApiError, type ErrorCode } from "@/lib/api/errors";
import { t, type MessageKey } from "@/lib/i18n";
import { dayAndMonth } from "@/lib/reports/report-view";
import type { DbError } from "@/server/master/db-errors";

// The P0001 codes of the opening-stock procedures (plan 2026-11-18 §3.9): state conflicts are 409, input problems 422.
type Coded = Extract<
  ErrorCode,
  | "opening_draft_changed"
  | "opening_location_counted"
  | "opening_count_open"
  | "opening_draft_not_empty"
  | "already_reversed"
  | "opening_request_reused"
  | "opening_qty_invalid"
  | "opening_cost_invalid"
  | "opening_line_duplicate"
  | "opening_draft_full"
  | "opening_date_in_future"
  | "opening_date_too_old"
  | "opening_date_after_receipt"
  | "opening_reason_invalid"
  | "ingredient_not_stock"
  | "location_not_found"
>;

const PROCEDURE_ERRORS: Record<Coded, number> = {
  opening_draft_changed: 409,
  opening_location_counted: 409,
  opening_count_open: 409,
  opening_draft_not_empty: 409,
  already_reversed: 409,
  opening_request_reused: 409,
  opening_qty_invalid: 422,
  opening_cost_invalid: 422,
  opening_line_duplicate: 422,
  opening_draft_full: 422,
  opening_date_in_future: 422,
  opening_date_too_old: 422,
  opening_date_after_receipt: 422,
  opening_reason_invalid: 422,
  ingredient_not_stock: 422,
  location_not_found: 422,
};

// Codes whose SQL DETAIL is a date (YYYY-MM-DD): passed on as details.date and worded in the message ("3 dic").
const DATED = new Set<Coded>(["opening_date_after_receipt", "opening_location_counted"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NOT_FOUND: Record<string, MessageKey> = {
  ingredient_not_found: "openingError.ingredient_not_found",
  opening_not_found: "openingError.opening_not_found",
};

/**
 * A database error of the opening-stock procedures as an ApiError with a safe Italian message (the database message is never
 * sent). Anything unexpected is a plain Error that names only the SQLSTATE, for the 500 handler.
 */
export function mapOpeningDbError(error: DbError): ApiError | Error {
  switch (error.code) {
    case "42501":
      return new ApiError(403, "forbidden", "Operazione non consentita per il tuo ruolo.");
    case "22023":
      return new ApiError(400, "invalid_request", "Richiesta non valida.");
    case "P0002":
      return new ApiError(
        404,
        "not_found",
        t(NOT_FOUND[error.message] ?? "openingError.not_found"),
      );
    case "P0001": {
      if (!Object.hasOwn(PROCEDURE_ERRORS, error.message)) break;
      const code = error.message as Coded;
      const detail = error.details ?? "";
      if (DATED.has(code) && ISO_DATE.test(detail)) {
        return new ApiError(
          PROCEDURE_ERRORS[code],
          code,
          t(`openingError.${code}`, { date: dayAndMonth(detail) }),
          {
            date: detail,
          },
        );
      }
      if (code === "opening_line_duplicate" && UUID.test(detail)) {
        return new ApiError(
          PROCEDURE_ERRORS[code],
          code,
          t("openingError.opening_line_duplicate"),
          {
            ingredientId: detail,
          },
        );
      }
      return new ApiError(PROCEDURE_ERRORS[code], code, t(`openingError.${code}`, { date: "—" }));
    }
  }
  return new Error(`Unexpected database error ${error.code ?? "(no code)"}`);
}
