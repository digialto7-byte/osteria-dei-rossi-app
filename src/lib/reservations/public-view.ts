import { isMessageKey, t, type MessageKey } from "@/lib/i18n";
import { INTL_LOCALE, type Locale } from "@/lib/i18n/locale";

// Formatting for the public booking pages (reservations plan §3.5). The database decides every rule; these only choose words, shapes and language.

/** `?lang=en` is English; anything else, a repeated value included, is Italian. */
export function localeFromQuery(value: string | string[] | undefined): Locale {
  return value === "en" ? "en" : "it";
}

/**
 * Whether a date is a closed weekday (ISO 1 Monday to 7 Sunday) or a closed date, from the page's own reply. It saves a request and shows the reason at once;
 * the slots function says the same, and SQL stays the authority.
 */
export function isClosedDay(
  date: string,
  closedWeekdays: readonly number[],
  closedDates: readonly string[],
): boolean {
  if (closedDates.includes(date)) return true;
  // Noon UTC is the same calendar day in every zone, so the weekday is the date's own.
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
  return closedWeekdays.includes(weekday);
}

/** 1 up to the largest online party. */
export function partyChoices(max: number): number[] {
  return Array.from({ length: Math.max(0, max) }, (_, index) => index + 1);
}

/** A `tel:` link from a number the owner typed: digits and a leading plus only. */
export function telHref(phone: string): string {
  const plus = phone.trim().startsWith("+") ? "+" : "";
  return `tel:${plus}${phone.replace(/\D/g, "")}`;
}

/** "ven 20 novembre 2026": a calendar date in the venue's zone, read at noon so no zone moves it. */
export function dayLabel(date: string, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Rome",
  }).format(new Date(`${date}T12:00:00Z`));
}

const CODE_KEYS: Record<string, MessageKey> = {
  rate_limited: "publicReservationError.rate_limited",
  form_too_fast: "publicReservationError.form_too_fast",
  form_expired: "publicReservationError.form_expired",
  form_invalid: "publicReservationError.form_invalid",
  not_found: "publicReservationError.not_found",
  reservations_unconfigured: "publicReservationError.unconfigured",
  link_invalid: "publicReservationError.link_invalid",
  cancel_closed: "publicReservationError.cancel_closed",
  status_invalid: "publicReservationError.cancel_status",
  payload_too_large: "publicReservationError.too_large",
  invalid_origin: "publicReservationError.origin",
};

function reasonOf(details: unknown): string | null {
  if (typeof details !== "object" || details === null || Array.isArray(details)) return null;
  const reason = (details as { reason?: unknown }).reason;
  return typeof reason === "string" ? reason : null;
}

/** The customer's message for an API error, in the page's language: by code, or by code and reason (slot and field errors). Never the server's text. */
export function errorMessage(error: { code: string; details?: unknown }, locale: Locale): string {
  const reason = reasonOf(error.details);
  const byReason =
    error.code === "slot_unavailable"
      ? `publicReservationError.slot.${reason}`
      : error.code === "invalid_request"
        ? `publicReservationError.field.${reason}`
        : null;
  const key: string | undefined = byReason ?? CODE_KEYS[error.code];
  return t(
    key !== undefined && isMessageKey(key) ? key : "publicReservation.error.generic",
    {},
    locale,
  );
}
