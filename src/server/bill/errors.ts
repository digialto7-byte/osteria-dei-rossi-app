import { ApiError, type ErrorCode } from "@/lib/api/errors";
import { t, type MessageKey } from "@/lib/i18n";
import type { DbError } from "@/server/master/db-errors";
import { splitInvalidDetails, unsentLinesDetails } from "./output";

type Coded = Extract<
  ErrorCode,
  | "session_closed"
  | "bill_changed"
  | "unsent_lines"
  | "split_invalid"
  | "receipt_number_invalid"
  | "receipt_type_invalid"
  | "payment_type_invalid"
>;

// The P0001 messages of the bill and close procedures (M21 plan §3.2, §3.5): code -> HTTP status.
const PROCEDURE_ERRORS: Record<Coded, number> = {
  session_closed: 409,
  bill_changed: 409,
  unsent_lines: 409,
  split_invalid: 422,
  receipt_number_invalid: 422,
  receipt_type_invalid: 422,
  payment_type_invalid: 422,
};

/** Reads the DETAIL text as JSON; anything that is not JSON is dropped. */
function parseDetail(raw: string | null | undefined): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Turns a database error from session_bill / close_table into an ApiError with a safe Italian message; the database message is never
 * sent. `unsent_lines` carries its line ids and `split_invalid` its reason as `details`, but only when the DETAIL is exactly the public
 * shape (strict schemas): an extra key drops the whole detail. Anything unexpected is a plain Error that names only the SQLSTATE.
 */
export function mapBillDbError(error: DbError): ApiError | Error {
  switch (error.code) {
    case "42501":
      return new ApiError(403, "forbidden", "Operazione non consentita per il tuo ruolo.");
    case "22023":
      return new ApiError(400, "invalid_request", "Richiesta non valida.");
    case "P0002":
      return new ApiError(404, "not_found", t("billError.session_not_found"));
    case "P0001": {
      // The schema keeps `?parts` in range, so this means the request was wrong, not that the person can fix it.
      if (error.message === "parts_invalid") {
        return new ApiError(400, "invalid_request", "Richiesta non valida.");
      }
      if (!Object.hasOwn(PROCEDURE_ERRORS, error.message)) break;
      const code = error.message as Coded;
      const message = t(`billError.${code}` as MessageKey);
      if (code === "unsent_lines") {
        const detail = unsentLinesDetails.safeParse(parseDetail(error.details));
        return new ApiError(409, code, message, detail.success ? detail.data : undefined);
      }
      if (code === "split_invalid") {
        const detail = splitInvalidDetails.safeParse(parseDetail(error.details));
        return new ApiError(422, code, message, detail.success ? detail.data : undefined);
      }
      return new ApiError(PROCEDURE_ERRORS[code], code, message);
    }
  }
  return new Error(`Unexpected database error ${error.code ?? "(no code)"}`);
}
