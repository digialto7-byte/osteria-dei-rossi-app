import { ApiError } from "@/lib/api/errors";
import type { DbError } from "@/server/master/db-errors";

/**
 * Turns a database error from the alert reads and procedures into an ApiError with a safe Italian
 * message. The procedures refuse with 42501 (role) and P0002 (not found, or not visible to the
 * caller, so a chef cannot learn that an owner-only alert exists). Anything else is unexpected: a
 * plain Error that names only the SQLSTATE, for the 500 handler and Sentry. The database message is
 * never sent or reported, because it can carry a payload.
 */
export function mapAlertError(error: DbError): ApiError | Error {
  switch (error.code) {
    case "42501":
      return new ApiError(403, "forbidden", "Operazione non consentita per il tuo ruolo.");
    case "P0002":
      return new ApiError(404, "not_found", "Avviso non trovato.");
    default:
      return new Error(`Unexpected database error ${error.code ?? "(no code)"}`);
  }
}
