import type { ApiErrorBody } from "@/lib/api/client";
import { t } from "@/lib/i18n";

/** The sentence for a failed trace search: the spec's words for a future date and a range over a year, the API's own words otherwise. */
export function searchErrorText(error: ApiErrorBody): { text: string; onDates: boolean } {
  if (error.code === "date_in_future") return { text: t("trace.err.future"), onDates: true };
  if (error.code === "range_too_long") return { text: t("trace.err.range"), onDates: true };
  return { text: error.message, onDates: false };
}
