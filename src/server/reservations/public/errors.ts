import { ApiError } from "@/lib/api/errors";
import { t, type MessageKey } from "@/lib/i18n";
import type { DbError } from "@/server/master/db-errors";
import { REQUEST_INVALID_REASONS, SLOT_UNAVAILABLE_REASONS } from "../constants";

/** Reads the DETAIL `{"reason": ...}` of a P0001, limited to the known codes. */
function reasonOf<T extends string>(
  details: string | null | undefined,
  known: readonly T[],
): T | null {
  if (!details) return null;
  try {
    const parsed: unknown = JSON.parse(details);
    const reason =
      typeof parsed === "object" && parsed !== null
        ? (parsed as { reason?: unknown }).reason
        : null;
    return known.find((r) => r === reason) ?? null;
  } catch {
    return null;
  }
}

const message = (key: string) => t(`publicReservationError.${key}` as MessageKey);

export const notFound = () => new ApiError(404, "not_found", message("not_found"));
export const unconfigured = () =>
  new ApiError(503, "reservations_unconfigured", message("unconfigured"));
export const linkInvalid = () => new ApiError(404, "link_invalid", message("link_invalid"));

/** The database refused the route's gate: the Vercel key and the Vault key differ, or the clocks do. Nothing the customer can fix. */
export const GATE_REFUSED = "reservation_gate_invalid";

/**
 * Turns a database error from an anon reservation function into an ApiError with a safe message in Italian (the page picks its own language from the code
 * and the reason). The database message is never sent, and a DETAIL is read only as one of the known reason codes. A gate refusal is a plain Error with a
 * code, so the caller can report it. Anything unexpected names only the SQLSTATE: the error reporter must never see a name, phone, e-mail or address.
 */
export function mapPublicDbError(error: DbError): ApiError | Error {
  switch (error.code) {
    case "22023":
      return new ApiError(400, "invalid_request", "Richiesta non valida.");
    case "P0002":
      return notFound();
    case "P0001":
      switch (error.message) {
        case "gate_invalid":
          return new Error(GATE_REFUSED);
        case "reservations_unconfigured":
          return unconfigured();
        case "rate_limited":
          return new ApiError(429, "rate_limited", message("rate_limited"));
        case "cancel_closed":
          return new ApiError(409, "cancel_closed", message("cancel_closed"));
        case "status_invalid":
          return new ApiError(409, "status_invalid", message("cancel_status"));
        case "slot_unavailable": {
          const reason = reasonOf(error.details, SLOT_UNAVAILABLE_REASONS);
          if (reason) {
            return new ApiError(422, "slot_unavailable", message(`slot.${reason}`), { reason });
          }
          break;
        }
        case "request_invalid": {
          const reason = reasonOf(error.details, REQUEST_INVALID_REASONS);
          if (reason) {
            return new ApiError(400, "invalid_request", message(`field.${reason}`), { reason });
          }
          break;
        }
      }
      break;
  }
  return new Error(`Unexpected database error ${error.code ?? "(no code)"}`);
}
