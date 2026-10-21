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
