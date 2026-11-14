import type { z } from "zod";
import { ApiError, type ErrorCode } from "@/lib/api/errors";
import { t, type MessageKey } from "@/lib/i18n";
import { reportError } from "@/lib/observability/report";
import type { DbError } from "@/server/master/db-errors";

type Coded = Extract<ErrorCode, "date_in_future" | "range_too_long" | "trace_depth_exceeded">;

// The P0001 messages of the trace functions (plan §3.3, §3.7): code -> HTTP status, all values the caller can fix.
const PROCEDURE_ERRORS: Record<Coded, number> = {
  date_in_future: 422,
  range_too_long: 422,
  trace_depth_exceeded: 422,
};

const unavailable = () => new ApiError(500, "report_unavailable", t("traceError.unavailable"));

/**
 * Turns a database error from the trace functions into an ApiError with a safe Italian message. The database message is never sent. Anything
 * unexpected is a plain Error that names only the SQLSTATE, for the 500 handler.
 */
export function mapTraceDbError(error: DbError): ApiError | Error {
  switch (error.code) {
    case "42501":
      return new ApiError(403, "forbidden", t("traceError.forbidden"));
    case "22023":
      return new ApiError(400, "invalid_request", "Richiesta non valida.");
    case "P0002":
      return new ApiError(404, "not_found", t("traceError.not_found"));
    case "P0001":
      if (Object.hasOwn(PROCEDURE_ERRORS, error.message)) {
        const code = error.message as Coded;
        return new ApiError(PROCEDURE_ERRORS[code], code, t(`traceError.${code}` as MessageKey));
      }
      break;
  }
  return new Error(`Unexpected database error ${error.code ?? "(no code)"}`);
}

/** Throws the ApiError of a database error, or a 500 report_unavailable (logged by SQLSTATE only: never the query, an id or a row). */
export function failRead(label: string, error: DbError): never {
  const mapped = mapTraceDbError(error);
  if (mapped instanceof ApiError) throw mapped;
  reportError(new Error(`${label} failed: ${error.code ?? "no_code"}`));
  throw unavailable();
}

/** The reply as the schema parses it; any key it does not know (an invoice or a purchase line on a chef reply) is a 500 that names only the label. */
export function parseRead<S extends z.ZodType>(
  label: string,
  schema: S,
  data: unknown,
): z.infer<S> {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    reportError(new Error(`${label} document rejected`));
    throw unavailable();
  }
  return parsed.data;
}
