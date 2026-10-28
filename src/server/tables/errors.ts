import { z } from "zod";
import { ApiError, type ErrorCode } from "@/lib/api/errors";
import { t, type MessageKey } from "@/lib/i18n";
import type { DbError } from "@/server/master/db-errors";
import { sessionOutput } from "./output";

type Coded = Extract<
  ErrorCode,
  | "table_name_taken"
  | "table_open"
  | "table_already_open"
  | "session_id_conflict"
  | "session_closed"
  | "table_inactive"
  | "covers_invalid"
  | "coperto_invalid"
  | "vat_rate_invalid"
  | "name_invalid"
  | "position_invalid"
>;

// The P0001 messages of the table procedures (M17 plan §3.4): code -> HTTP status.
const PROCEDURE_ERRORS: Record<Coded, number> = {
  table_name_taken: 409,
  table_open: 409,
  table_already_open: 409,
  session_id_conflict: 409,
  session_closed: 409,
  table_inactive: 422,
  covers_invalid: 422,
  coperto_invalid: 422,
  vat_rate_invalid: 422,
  name_invalid: 422,
  position_invalid: 422,
};

// vat_rate_invalid keeps the text of the menu form.
const TEXT: Partial<Record<Coded, MessageKey>> = { vat_rate_invalid: "menuError.vat_rate_invalid" };

const NOT_FOUND: Record<string, MessageKey> = {
  table_not_found: "tableError.table_not_found",
  session_not_found: "tableError.session_not_found",
};

const alreadyOpenDetail = z.strictObject({ sessionId: z.uuid() });

/**
 * table_already_open carries only {"sessionId": "<uuid>"} in the Postgres DETAIL (the DETAIL of every error is written
 * to the server log, so no staff name goes there). Anything else in the detail is dropped.
 */
export function alreadyOpenSessionId(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const detail = alreadyOpenDetail.safeParse(parsed);
  return detail.success ? detail.data.sessionId : undefined;
}

/** The 409 for an open table: names the waiter and carries the session when it could be read, else says it plainly. */
export function alreadyOpenError(session: z.infer<typeof sessionOutput> | undefined): ApiError {
  return session
    ? new ApiError(
        409,
        "table_already_open",
        t("tableError.table_already_open_by", { name: session.waiter.displayName }),
        { session },
      )
    : new ApiError(409, "table_already_open", t("tableError.table_already_open"));
}

/**
 * Turns a database error from the table functions into an ApiError with a safe Italian message. The database
 * message is never sent. Anything unexpected is a plain Error that names only the SQLSTATE, for the 500 handler.
 */
export function mapTablesDbError(error: DbError): ApiError | Error {
  switch (error.code) {
    case "42501":
      return new ApiError(403, "forbidden", "Operazione non consentita per il tuo ruolo.");
    case "22023":
      return new ApiError(400, "invalid_request", "Richiesta non valida.");
    case "P0002": {
      const key = Object.hasOwn(NOT_FOUND, error.message)
        ? NOT_FOUND[error.message]!
        : "tableError.table_not_found";
      return new ApiError(404, "not_found", t(key));
    }
    case "P0001":
      // The open session is read by id in openTable (alreadyOpenSessionId, table_session_get).
      if (error.message === "table_already_open") return alreadyOpenError(undefined);
      if (Object.hasOwn(PROCEDURE_ERRORS, error.message)) {
        const code = error.message as Coded;
        const key = TEXT[code] ?? (`tableError.${code}` as MessageKey);
        return new ApiError(PROCEDURE_ERRORS[code], code, t(key));
      }
      break;
  }
  return new Error(`Unexpected database error ${error.code ?? "(no code)"}`);
}
