import { t } from "@/lib/i18n";
import { DEFAULT_LOCALE, INTL_LOCALE, type Locale } from "@/lib/i18n/locale";
import { formatEuro } from "@/lib/money/format";

// Presentation helpers of the end-of-day screen (M21 plan §3.6). Pure: the database computed the difference (app minus register, Q131);
// these only word it. Nothing here adds or compares money.

const MINUS = "−";
const NBSP = " ";

/** Who may see and use the end-of-day screen (the database enforces it too). */
export function canCloseDay(role: string | undefined): boolean {
  return role === "owner" || role === "admin";
}

/** "L'app registra 12,50 € in più della cassa" / "... in meno ..." (the size of the gap, no sign) / "App e cassa coincidono". */
export function differenceSentence(amount: number, locale: Locale = DEFAULT_LOCALE): string {
  if (amount === 0) return t("dayClose.difference.equal", {}, locale);
  const key = amount > 0 ? "dayClose.difference.more" : "dayClose.difference.less";
  return t(key, { amount: formatEuro(Math.abs(amount), locale) }, locale);
}

const percentFormatters = new Map<Locale, Intl.NumberFormat>();
function percent(value: number, locale: Locale): string {
  let formatter = percentFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(INTL_LOCALE[locale], {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    percentFormatters.set(locale, formatter);
  }
  return formatter.format(Math.abs(value));
}

const sign = (value: number) => (value > 0 ? "+" : value < 0 ? MINUS : "");

/** "+12,50 € (+1,0 %)", with the real minus sign U+2212; the percentage is left out when the register total was 0. */
export function differenceFigure(
  amount: number,
  pct: number | null,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const figure = `${sign(amount)}${formatEuro(Math.abs(amount), locale)}`;
  return pct === null ? figure : `${figure} (${sign(pct)}${percent(pct, locale)}${NBSP}%)`;
}

export type DifferenceTone = "over" | "under" | "equal";

/** A colour hint that reinforces the sentence; the sentence carries the meaning. */
export function differenceTone(amount: number): DifferenceTone {
  return amount > 0 ? "over" : amount < 0 ? "under" : "equal";
}

const titleFormatters = new Map<Locale, Intl.DateTimeFormat>();

/** "Giornata di giovedì 5 novembre" for the business date "2026-11-05" (a calendar date: no time zone moves it). */
export function businessDayTitle(isoDate: string, locale: Locale = DEFAULT_LOCALE): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  const [year, month, day] = parts ? parts.slice(1).map(Number) : [];
  const date = parts ? new Date(Date.UTC(year!, month! - 1, day!)) : null;
  if (!date || date.getUTCMonth() !== month! - 1 || date.getUTCDate() !== day) {
    throw new RangeError("businessDayTitle: expected a real date as YYYY-MM-DD");
  }
  let formatter = titleFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      timeZone: "UTC",
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    titleFormatters.set(locale, formatter);
  }
  return t("dayClose.title", { date: formatter.format(date) }, locale);
}
