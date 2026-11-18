import { DEFAULT_LOCALE, INTL_LOCALE, type Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n";
import { dayAndMonth } from "@/lib/reports/report-view";
import { VENUE_TIME_ZONE } from "@/lib/time/format";
import { addDays, venueDate } from "@/lib/time/venue-date";

/** Shown where a date is unknown (a venue with no activity yet). */
export const EM_DASH = "—";

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

function isRealDay(value: string): boolean {
  const match = DAY.exec(value);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Today in Europe/Rome, from the given clock. */
export function romeToday(now: Date): string {
  return venueDate(now, VENUE_TIME_ZONE);
}

/** "oggi", "ieri", "12 nov", "12 nov 2025", or a dash when there is no day. */
export function formatActivityDay(
  day: string | null,
  today: string,
  locale: Locale = DEFAULT_LOCALE,
): string {
  if (day === null) return EM_DASH;
  if (day === today) return t("console.day.today", {}, locale);
  if (day === addDays(today, -1)) return t("console.day.yesterday", {}, locale);
  const short = dayAndMonth(day, locale);
  return day.slice(0, 4) === today.slice(0, 4) ? short : `${short} ${day.slice(0, 4)}`;
}

/** "21 ott 2026" for a day, or for the Europe/Rome day of an instant. */
export function formatLongDay(dayOrInstant: string, locale: Locale = DEFAULT_LOCALE): string {
  const day = DAY.test(dayOrInstant)
    ? dayOrInstant
    : venueDate(new Date(dayOrInstant), VENUE_TIME_ZONE);
  return `${dayAndMonth(day, locale)} ${day.slice(0, 4)}`;
}

const instantFormatters = new Map<Locale, Intl.DateTimeFormat>();

/** "14 nov 2026, 09:40" in Europe/Rome. Throws a RangeError for an invalid instant. */
export function formatInstant(instant: string, locale: Locale = DEFAULT_LOCALE): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) throw new RangeError("formatInstant: invalid instant");
  let formatter = instantFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      timeZone: VENUE_TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    instantFormatters.set(locale, formatter);
  }
  return `${formatLongDay(instant, locale)}, ${formatter.format(date)}`;
}

/** The Registro's default range: the last 30 Europe/Rome days, today included. */
export function defaultRange(today: string): { dal: string; al: string } {
  return { dal: addDays(today, -29), al: today };
}

export type RangeProblem = "invalid" | "order" | "span";

/** What is wrong with a from/to pair, or null. The server accepts at most 366 days after `dal`. */
export function rangeProblem(dal: string, al: string): RangeProblem | null {
  if (!isRealDay(dal) || !isRealDay(al)) return "invalid";
  if (dal > al) return "order";
  const span = (Date.parse(`${al}T00:00:00Z`) - Date.parse(`${dal}T00:00:00Z`)) / DAY_MS;
  return span > 366 ? "span" : null;
}
