import { ApiError } from "@/lib/api/errors";
import { t } from "@/lib/i18n";
import type { DbError } from "@/server/master/db-errors";

/**
 * Turns a database error from public.audit_log into an ApiError with a safe Italian message. The database message
 * is never sent. Anything unexpected is a plain Error that names only the SQLSTATE.
 */
export function mapAuditDbError(error: DbError): ApiError | Error {
  switch (error.code) {
    case "42501":
      return new ApiError(403, "forbidden", "Operazione non consentita per il tuo ruolo.");
    case "22023":
      return new ApiError(400, "invalid_request", "Richiesta non valida.");
    case "P0001":
      if (error.message === "range_invalid" || error.message === "range_too_long") {
        return new ApiError(422, error.message, t(`stockError.${error.message}`));
      }
      break;
  }
  return new Error(`Unexpected database error ${error.code ?? "(no code)"}`);
}
