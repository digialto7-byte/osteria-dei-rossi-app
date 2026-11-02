import { ApiError } from "@/lib/api/errors";
import { t, type MessageKey } from "@/lib/i18n";
import type { DbError } from "@/server/master/db-errors";
import { SERVICE_PERIOD_REASONS, type ServicePeriodReason } from "./constants";

function reasonOf(details: string | null | undefined): ServicePeriodReason | null {
  if (!details) return null;
  try {
    const parsed: unknown = JSON.parse(details);
    const reason =
      typeof parsed === "object" && parsed !== null
        ? (parsed as { reason?: unknown }).reason
        : null;
    return SERVICE_PERIOD_REASONS.find((r) => r === reason) ?? null;
  } catch {
    return null;
  }
}

/**
 * Turns a database error from the service functions into an ApiError with a safe Italian message (M25c plan §3.4). The database message is
 * never sent, and a DETAIL is read only as one of the known reason codes. Anything unexpected is a plain Error that names only the SQLSTATE.
 */
export function mapServicesDbError(error: DbError): ApiError | Error {
  switch (error.code) {
    case "42501":
      return new ApiError(403, "forbidden", t("serviceError.forbidden"));
    case "22023":
      return new ApiError(400, "invalid_request", "Richiesta non valida.");
    case "P0002":
      if (error.message === "session_not_found") {
        return new ApiError(404, "session_not_found", t("serviceError.session_not_found"));
      }
      break;
    case "P0001":
      if (error.message === "service_unknown") {
        return new ApiError(422, "service_unknown", t("serviceError.service_unknown"));
      }
      if (error.message === "service_day_final") {
        return new ApiError(409, "service_day_final", t("serviceError.service_day_final"));
      }
      if (error.message === "business_date_invalid") {
        return new ApiError(422, "business_date_invalid", t("dayCloseError.business_date_invalid"));
      }
      if (error.message === "service_periods_invalid") {
        const reason = reasonOf(error.details);
        if (reason) {
          return new ApiError(
            422,
            "service_periods_invalid",
            t(`serviceError.reason.${reason}` as MessageKey),
            { reason },
          );
        }
      }
      break;
  }
  return new Error(`Unexpected database error ${error.code ?? "(no code)"}`);
}
