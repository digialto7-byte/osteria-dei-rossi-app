import { ApiError } from "@/lib/api/errors";
import { t } from "@/lib/i18n";
import type { DbError } from "@/server/master/db-errors";

/**
 * Turns a database error from purge_demo_tenant into an ApiError with a safe Italian message. 42501 has two
 * causes that share a SQLSTATE: a role refusal and "this tenant is not a demo". They differ only by message.
 * The database message is never sent. Anything unexpected is a plain Error naming only the SQLSTATE.
 */
export function mapDemoDbError(error: DbError): ApiError | Error {
  if (error.code === "42501") {
    if (error.message === "not_demo_tenant") {
      return new ApiError(403, "not_demo_tenant", t("demoError.not_demo_tenant"));
    }
    return new ApiError(403, "forbidden", "Operazione non consentita per il tuo ruolo.");
  }
  if (error.code === "P0001" && error.message === "confirm_name_mismatch") {
    return new ApiError(422, "confirm_name_mismatch", t("demoError.confirm_name_mismatch"));
  }
  return new Error(`Unexpected database error ${error.code ?? "(no code)"}`);
}
