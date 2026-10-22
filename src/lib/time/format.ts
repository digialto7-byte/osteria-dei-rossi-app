import { DEFAULT_LOCALE, INTL_LOCALE, type Locale } from "@/lib/i18n/locale";

export const VENUE_TIME_ZONE = "Europe/Rome";

const formatters = new Map<Locale, Intl.DateTimeFormat>();

function dateTimeFormatter(locale: Locale): Intl.DateTimeFormat {
  let formatter = formatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      timeZone: VENUE_TIME_ZONE,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(locale, formatter);
  }
  return formatter;
}

/** Formats an instant in venue time (Europe/Rome), e.g. "25/10/2026, 02:30". */
export function formatDateTime(instant: Date, locale: Locale = DEFAULT_LOCALE): string {
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError("formatDateTime: invalid date");
  }
  return dateTimeFormatter(locale).format(instant);
}

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const calendarFormatters = new Map<Locale, Intl.DateTimeFormat>();

/**
 * Formats a date without a time ("2026-10-15", as an invoice date or due date) as the venue
 * writes it, e.g. "15/10/2026". It is a calendar date, not an instant, so no zone shifts it.
 */
export function formatCalendarDate(isoDate: string, locale: Locale = DEFAULT_LOCALE): string {
  const parts = CALENDAR_DATE.exec(isoDate);
  const [year, month, day] = parts ? parts.slice(1).map(Number) : [];
  const date = parts ? new Date(Date.UTC(year!, month! - 1, day!)) : null;
  if (!date || date.getUTCMonth() !== month! - 1 || date.getUTCDate() !== day) {
    throw new RangeError("formatCalendarDate: expected a real date as YYYY-MM-DD");
  }
  let formatter = calendarFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      timeZone: "UTC",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    calendarFormatters.set(locale, formatter);
  }
  return formatter.format(date);
}
