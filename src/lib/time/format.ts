import { INTL_LOCALE, type Locale } from "@/lib/i18n/locale";
import { currentVenueSettings } from "@/lib/venue/current";
import { DEFAULT_TIME_ZONE } from "@/lib/venue/settings";

/** The platform console's zone (SP3). Venue code reads the tenant's zone from the store or the caller. */
export const VENUE_TIME_ZONE = DEFAULT_TIME_ZONE;

const storeLocale = (): Locale => currentVenueSettings().locale;
const storeZone = (): string => currentVenueSettings().timeZone;

const formatters = new Map<string, Intl.DateTimeFormat>();

function dateTimeFormatter(locale: Locale, zone: string): Intl.DateTimeFormat {
  const key = `${locale}|${zone}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      timeZone: zone,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(key, formatter);
  }
  return formatter;
}

/** Formats an instant in the venue's time (the tenant's zone, Europe/Rome for tenant #1), e.g. "25/10/2026, 02:30". */
export function formatDateTime(
  instant: Date,
  locale: Locale = storeLocale(),
  zone: string = storeZone(),
): string {
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError("formatDateTime: invalid date");
  }
  return dateTimeFormatter(locale, zone).format(instant);
}

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const calendarFormatters = new Map<Locale, Intl.DateTimeFormat>();

/**
 * Formats a date without a time ("2026-10-15", as an invoice date or due date) as the venue
 * writes it, e.g. "15/10/2026". It is a calendar date, not an instant, so no zone shifts it.
 */
export function formatCalendarDate(isoDate: string, locale: Locale = storeLocale()): string {
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

const timeFormatters = new Map<string, Intl.DateTimeFormat>();

/** Formats the clock time of an instant in the venue's zone, e.g. "21:15". */
export function formatTime(
  instant: Date,
  locale: Locale = storeLocale(),
  zone: string = storeZone(),
): string {
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError("formatTime: invalid date");
  }
  const key = `${locale}|${zone}`;
  let formatter = timeFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    timeFormatters.set(key, formatter);
  }
  return formatter.format(instant);
}

const weekdayTimeFormatters = new Map<string, Intl.DateTimeFormat>();

/** The short weekday and clock time of an instant in venue time (Europe/Rome), e.g. "mar 11:00" / "Tue 11:00". */
export function formatWeekdayTime(
  instant: Date,
  locale: Locale = storeLocale(),
  zone: string = storeZone(),
): string {
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError("formatWeekdayTime: invalid date");
  }
  const key = `${locale}|${zone}`;
  let formatter = weekdayTimeFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      timeZone: zone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    weekdayTimeFormatters.set(key, formatter);
  }
  return formatter
    .formatToParts(instant)
    .map((part) => part.value)
    .join("");
}

const weekdayFormatters = new Map<Locale, Intl.DateTimeFormat>();

/** The short weekday of a calendar date ("2026-11-05" is "gio" / "Thu"); a calendar date has no zone. */
export function formatWeekday(isoDate: string, locale: Locale = storeLocale()): string {
  const parts = CALENDAR_DATE.exec(isoDate);
  const [year, month, day] = parts ? parts.slice(1).map(Number) : [];
  const date = parts ? new Date(Date.UTC(year!, month! - 1, day!)) : null;
  if (!date || date.getUTCMonth() !== month! - 1 || date.getUTCDate() !== day) {
    throw new RangeError("formatWeekday: expected a real date as YYYY-MM-DD");
  }
  let formatter = weekdayFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(INTL_LOCALE[locale], { timeZone: "UTC", weekday: "short" });
    weekdayFormatters.set(locale, formatter);
  }
  return formatter.format(date);
}
