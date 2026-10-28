import { ApiError } from "@/lib/api/errors";
import { t } from "@/lib/i18n";
import type { DbError } from "@/server/master/db-errors";

/**
 * Turns a database error from kitchen_tickets into an ApiError with a safe Italian message; the database message is never
 * sent. Anything unexpected is a plain Error that names only the SQLSTATE, for the 500 handler.
 */
export function mapKitchenDbError(error: DbError): ApiError | Error {
  if (error.code === "42501") {
    return new ApiError(403, "forbidden", t("kitchen.forbidden"));
  }
  return new Error(`Unexpected database error ${error.code ?? "(no code)"}`);
}
