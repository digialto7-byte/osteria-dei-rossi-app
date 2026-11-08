import { ApiError, type ErrorCode } from "@/lib/api/errors";
import { t, type MessageKey } from "@/lib/i18n";
import type { DbError } from "@/server/master/db-errors";
import {
  GROUP_INVALID_REASONS,
  NOT_READY_REASONS,
  SETTINGS_INVALID_REASONS,
  TABLE_BOOKING_INVALID_REASONS,
} from "./constants";

/** Reads the DETAIL of a P0001 as `{ [key]: string }` limited to the known codes; anything else is dropped (the DETAIL is codes only, but trust nothing). */
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

function reasonsOf<T extends string>(details: string | null | undefined, known: readonly T[]): T[] {
  if (!details) return [];
  try {
    const parsed: unknown = JSON.parse(details);
    const list =
      typeof parsed === "object" && parsed !== null
        ? (parsed as { reasons?: unknown }).reasons
        : null;
    if (!Array.isArray(list)) return [];
    return known.filter((r) => list.includes(r));
  } catch {
    return [];
  }
}

type Coded = Extract<ErrorCode, "slug_taken">;
const CONFLICTS: Record<Coded, number> = { slug_taken: 409 };

const NOT_FOUND: Record<string, MessageKey> = {
  table_not_found: "tableError.table_not_found",
  group_not_found: "reservationError.group_not_found",
};

/**
 * Turns a database error from the reservation settings, tables and groups functions into an ApiError with a safe Italian message. The database message is never
 * sent, and a DETAIL is read only as one of the known reason codes. Anything unexpected is a plain Error that names only the SQLSTATE.
 */
export function mapReservationsDbError(error: DbError): ApiError | Error {
  switch (error.code) {
    case "42501":
      return new ApiError(403, "forbidden", t("reservationError.forbidden"));
    case "22023":
      return new ApiError(400, "invalid_request", "Richiesta non valida.");
    case "P0002": {
      const key = Object.hasOwn(NOT_FOUND, error.message)
        ? NOT_FOUND[error.message]!
        : "reservationError.not_found";
      return new ApiError(404, "not_found", t(key));
    }
    case "P0001": {
      if (error.message === "reservation_settings_invalid") {
        const reason = reasonOf(error.details, SETTINGS_INVALID_REASONS);
        if (reason) {
          return new ApiError(
            422,
            "reservation_settings_invalid",
            t(`reservationError.settings.${reason}` as MessageKey),
            { reason },
          );
        }
      }
      if (error.message === "reservations_not_ready") {
        const reasons = reasonsOf(error.details, NOT_READY_REASONS);
        if (reasons.length > 0) {
          const list = reasons
            .map((reason) => t(`reservationError.notReady.${reason}` as MessageKey))
            .join(", ");
          return new ApiError(
            422,
            "reservations_not_ready",
            t("reservationError.not_ready", { list }),
            { reasons },
          );
        }
      }
      if (error.message === "group_invalid") {
        const reason = reasonOf(error.details, GROUP_INVALID_REASONS);
        if (reason) {
          return new ApiError(
            422,
            "group_invalid",
            t(`reservationError.group.${reason}` as MessageKey),
            { reason },
          );
        }
      }
      if (error.message === "table_booking_invalid") {
        const reason = reasonOf(error.details, TABLE_BOOKING_INVALID_REASONS);
        if (reason) {
          return new ApiError(
            422,
            "table_booking_invalid",
            t(`reservationError.booking.${reason}` as MessageKey),
            { reason },
          );
        }
      }
      if (Object.hasOwn(CONFLICTS, error.message)) {
        const code = error.message as Coded;
        return new ApiError(CONFLICTS[code], code, t(`reservationError.${code}` as MessageKey));
      }
      break;
    }
  }
  return new Error(`Unexpected database error ${error.code ?? "(no code)"}`);
}
