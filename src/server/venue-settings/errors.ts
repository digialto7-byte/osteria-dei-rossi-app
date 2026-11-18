import { ApiError, type ErrorCode } from "@/lib/api/errors";
import { t, type MessageKey } from "@/lib/i18n";
import type { DbError } from "@/server/master/db-errors";

type Coded = Extract<
  ErrorCode,
  | "locale_invalid"
  | "vat_rate_invalid"
  | "receipt_type_invalid"
  | "payment_type_invalid"
  | "settings_list_empty"
>;

// The P0001 messages of public.set_tenant_settings (SP1 plan §3.3): code -> HTTP status.
const PROCEDURE_ERRORS: Record<Coded, number> = {
  locale_invalid: 422,
  vat_rate_invalid: 422,
  receipt_type_invalid: 422,
  payment_type_invalid: 422,
  settings_list_empty: 422,
};

/**
 * Turns a database error from set_tenant_settings into an ApiError with a safe Italian message. The database message is never sent;
 * anything unexpected is a plain Error that names only the SQLSTATE, for the 500 handler.
 */
export function mapVenueSettingsDbError(error: DbError): ApiError | Error {
  switch (error.code) {
    case "42501":
      return new ApiError(403, "forbidden", "Operazione non consentita per il tuo ruolo.");
    case "22023":
      return new ApiError(400, "invalid_request", "Richiesta non valida.");
    case "P0001":
      if (Object.hasOwn(PROCEDURE_ERRORS, error.message)) {
        const code = error.message as Coded;
        return new ApiError(
          PROCEDURE_ERRORS[code],
          code,
          t(`venueSettingsError.${code}` as MessageKey),
        );
      }
      break;
  }
  return new Error(`Unexpected database error ${error.code ?? "(no code)"}`);
}
