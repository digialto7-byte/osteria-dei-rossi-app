import { ApiError } from "@/lib/api/errors";
import { t } from "@/lib/i18n";
import type { DbError } from "@/server/master/db-errors";

/**
 * Turns a database error from kitchen_tickets, kitchen_mark_line or kitchen_set_ticket into an ApiError with a safe Italian
 * message; the database message and detail are never sent. Anything unexpected is a plain Error that names only the SQLSTATE,
 * for the 500 handler.
 */
export function mapKitchenDbError(error: DbError): ApiError | Error {
  if (error.code === "42501") {
    return new ApiError(403, "forbidden", t("kitchen.forbidden"));
  }
  if (error.code === "22023") {
    return new ApiError(400, "invalid_request", "Richiesta non valida.");
  }
  if (error.code === "P0002" && error.message === "line_not_found") {
    return new ApiError(404, "line_not_found", t("kitchen.error.not_found"));
  }
  if (error.code === "P0002" && error.message === "ticket_not_found") {
    return new ApiError(404, "ticket_not_found", t("kitchen.error.not_found"));
  }
  if (error.code === "P0001" && error.message === "session_closed") {
    return new ApiError(409, "session_closed", t("kitchen.error.session_closed"));
  }
  return new Error(`Unexpected database error ${error.code ?? "(no code)"}`);
}
