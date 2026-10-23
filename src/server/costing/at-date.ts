import { ApiError } from "@/lib/api/errors";
import { t } from "@/lib/i18n";
import { venueDate } from "@/lib/time/venue-date";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function invalid(): ApiError {
  return new ApiError(400, "invalid_request", "Parametri non validi.");
}

function isRealDate(text: string): boolean {
  const parts = ISO_DATE.exec(text);
  if (!parts) return false;
  const [year, month, day] = parts.slice(1).map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return date.getUTCMonth() === month! - 1 && date.getUTCDate() === day;
}

/** A route without query parameters: any parameter is a 400. */
export function assertNoQuery(url: URL): void {
  if ([...url.searchParams.keys()].length > 0) throw invalid();
}

/**
 * `?at=YYYY-MM-DD` (a Europe/Rome calendar date); no parameter means "now" (null). Anything else in
 * the query, a malformed or repeated `at` is a 400; a date after today in Rome is a 422. `now` is
 * injected so tests do not depend on the clock.
 */
export function parseAtDate(url: URL, now: Date = new Date()): string | null {
  for (const key of url.searchParams.keys()) if (key !== "at") throw invalid();
  const values = url.searchParams.getAll("at");
  if (values.length === 0) return null;
  const value = values[0]!;
  if (values.length > 1 || !isRealDate(value)) throw invalid();
  if (value > venueDate(now)) {
    throw new ApiError(422, "date_in_future", t("costError.date_in_future"));
  }
  return value;
}
