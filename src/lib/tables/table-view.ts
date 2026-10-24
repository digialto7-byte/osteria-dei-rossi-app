import type { BadgeTone } from "@/components/ui";
import { isMessageKey, t, tn } from "@/lib/i18n";
import { DEFAULT_LOCALE, INTL_LOCALE, type Locale } from "@/lib/i18n/locale";
import { formatEuro } from "@/lib/money/format";
import { formatTime, VENUE_TIME_ZONE } from "@/lib/time/format";
import { MAX_TABLE_COVERS } from "@/server/tables/constants";
import { TABLE_STATUS_VALUES, type SessionCoperto } from "@/server/tables/output";

// Presentation helpers for the table screens. Pure: they only word what the API already decided (the status is the
// server's derivation, the coperto total is the server's number, the instants are shown in Europe/Rome). The role
// lists mirror the routes. Nothing here computes a status, a total or a date.

export const TABLE_STATUSES = TABLE_STATUS_VALUES;

/** Owner, admin and waiter use the tables; the chef gets 403 in M17. Mirrors the API's role list. */
export const canUseTables = (role: string): boolean =>
  role === "owner" || role === "admin" || role === "waiter";

/** Only owner and admin name the tables and set the coperto. Mirrors the API's role list. */
export const canConfigureTables = (role: string): boolean => role === "owner" || role === "admin";

/** "Libero", "Aperto", ...; an unknown status gets a neutral word, never the raw code. */
export function statusWord(status: string, locale: Locale = DEFAULT_LOCALE): string {
  const key = `tables.status.${status}`;
  return t(isMessageKey(key) ? key : "tables.status.unknown", {}, locale);
}

const TONES: Record<string, BadgeTone> = {
  free: "neutral",
  open: "success",
  courses_sent: "info",
  bill_requested: "warning",
  closed: "neutral",
};

/** The tone reinforces the word; it never carries the meaning alone. */
export function statusTone(status: string): BadgeTone {
  return Object.hasOwn(TONES, status) ? TONES[status]! : "neutral";
}

/** "1 coperto", "4 coperti". */
export function coversLine(covers: number, locale: Locale = DEFAULT_LOCALE): string {
  return tn("tables.covers", covers, locale);
}

const dateFormatters = new Map<Locale, Intl.DateTimeFormat>();

// "25/10": day and month in venue time.
function dayMonth(instant: Date, locale: Locale): string {
  let formatter = dateFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      timeZone: VENUE_TIME_ZONE,
      day: "2-digit",
      month: "2-digit",
    });
    dateFormatters.set(locale, formatter);
  }
  const parts = formatter.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("day")}/${part("month")}`;
}

/**
 * "Cameriere Demo · 20:15" for a table opened in today's business day; "Cameriere Demo · 25/10 01:30" when it was
 * not (the server's `openedToday`). The instant is shown in Europe/Rome.
 */
export function openedLine(
  waiter: string,
  openedAt: string,
  openedToday: boolean,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const instant = new Date(openedAt);
  const clock = formatTime(instant, locale);
  const when = openedToday ? clock : `${dayMonth(instant, locale)} ${clock}`;
  return t("tables.opened", { waiter, when }, locale);
}

/** "Coperto 6,00 €" from the server's total; null when the table has no coperto. */
export function copertoLine(
  coperto: SessionCoperto | null,
  locale: Locale = DEFAULT_LOCALE,
): string | null {
  return coperto
    ? t("tables.coperto", { amount: formatEuro(coperto.total, locale) }, locale)
    : null;
}

/** The covers after a tap on "−" or "+": the step added, kept within 1 to 99. */
export function nextCovers(current: number, step: number): number {
  return Math.min(MAX_TABLE_COVERS, Math.max(1, current + step));
}
