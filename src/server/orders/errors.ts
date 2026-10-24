import { ApiError, type ErrorCode } from "@/lib/api/errors";
import { t, type MessageKey } from "@/lib/i18n";
import { conflictMessage } from "@/lib/orders/order-view";
import type { DbError } from "@/server/master/db-errors";
import { conflictDetails, itemUnavailableDetails } from "./output";

type Coded = Extract<
  ErrorCode,
  | "qty_invalid"
  | "note_invalid"
  | "course_invalid"
  | "client_time_invalid"
  | "price_missing"
  | "session_closed"
  | "line_id_conflict"
>;

// The plain P0001 messages of the order procedures (M18 plan §3.4): code -> HTTP status. `conflict` and
// `item_unavailable` carry a JSON DETAIL and are handled apart.
const PROCEDURE_ERRORS: Record<Coded, number> = {
  qty_invalid: 422,
  note_invalid: 422,
  course_invalid: 422,
  client_time_invalid: 422,
  price_missing: 422,
  session_closed: 409,
  line_id_conflict: 409,
};

const NOT_FOUND: Record<string, MessageKey> = {
  session_not_found: "orderError.session_not_found",
  menu_item_not_found: "orderError.menu_item_not_found",
  line_not_found: "orderError.line_not_found",
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
 * Turns a database error from the order functions into an ApiError with a safe Italian message. The database
 * message is never sent. `conflict` and `item_unavailable` carry their DETAIL as `details`, but only when it is
 * exactly the public shape (strict schema): an extra key in the detail drops the whole detail. Anything unexpected is
 * a plain Error that names only the SQLSTATE, for the 500 handler.
 */
export function mapOrderDbError(error: DbError): ApiError | Error {
  switch (error.code) {
    case "42501":
      return new ApiError(403, "forbidden", "Operazione non consentita per il tuo ruolo.");
    case "22023":
      return new ApiError(400, "invalid_request", "Richiesta non valida.");
    case "P0002": {
      const key = Object.hasOwn(NOT_FOUND, error.message)
        ? NOT_FOUND[error.message]!
        : "orderError.session_not_found";
      return new ApiError(404, "not_found", t(key));
    }
    case "P0001": {
      if (error.message === "conflict") {
        const detail = conflictDetails.safeParse(parseDetail(error.details));
        return detail.success
          ? new ApiError(
              409,
              "conflict",
              conflictMessage(detail.data.reason, detail.data.line),
              detail.data,
            )
          : new ApiError(409, "conflict", t("orderError.conflict_stale_unknown"));
      }
      if (error.message === "item_unavailable") {
        const detail = itemUnavailableDetails.safeParse(parseDetail(error.details));
        return new ApiError(
          409,
          "item_unavailable",
          t("orderError.item_unavailable"),
          detail.success ? detail.data : undefined,
        );
      }
      if (Object.hasOwn(PROCEDURE_ERRORS, error.message)) {
        const code = error.message as Coded;
        return new ApiError(PROCEDURE_ERRORS[code], code, t(`orderError.${code}` as MessageKey));
      }
      break;
    }
  }
  return new Error(`Unexpected database error ${error.code ?? "(no code)"}`);
}
