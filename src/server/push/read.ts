import type { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { t } from "@/lib/i18n";
import { reportError } from "@/lib/observability/report";
import type { DbError } from "@/server/master/db-errors";
import { mapPushDbError } from "./errors";

// Shared by the push list, forecast and discards services (M23 plan §3.4). A reply is parsed with the strict schema of the caller's role before it is
// sent, and a database error is mapped to a safe message; what cannot be mapped or parsed is a 500 report_unavailable. Logs carry codes only.

const unavailable = () => new ApiError(500, "report_unavailable", t("pushError.unavailable"));

/** Throws the ApiError of a database error, or a 500 report_unavailable (logged by SQLSTATE only). */
export function failRead(label: string, error: DbError): never {
  const mapped = mapPushDbError(error);
  if (mapped instanceof ApiError) throw mapped;
  reportError(new Error(`${label} failed: ${error.code ?? "no_code"}`));
  throw unavailable();
}

/** The reply as the schema parses it; any key it does not know is a 500, so a cost, a price or covers can never ride along to the wrong role. */
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
