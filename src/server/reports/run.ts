import type { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { t } from "@/lib/i18n";
import { reportError } from "@/lib/observability/report";
import type { DbError } from "@/server/master/db-errors";
import { mapReportDbError } from "./errors";

// Shared by the report services (M22 plan §3.5). A reply is parsed with a strict schema before it is sent, and a database error is mapped to a safe
// message; what cannot be mapped or parsed is a 500 report_unavailable. Logs carry codes only, never a message, a path or a value.

const unavailable = () => new ApiError(500, "report_unavailable", t("reportError.unavailable"));

/** Throws the ApiError of a database error, or a 500 report_unavailable (logged by SQLSTATE only). */
export function failReport(label: string, error: DbError): never {
  const mapped = mapReportDbError(error);
  if (mapped instanceof ApiError) throw mapped;
  reportError(new Error(`${label} failed: ${error.code ?? "no_code"}`));
  throw unavailable();
}

/** The reply as the schema parses it; any key it does not know is a 500, so a cost can never ride along. */
export function parseReport<S extends z.ZodType>(
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
