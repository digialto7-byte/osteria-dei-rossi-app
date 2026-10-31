import { t, type MessageKey } from "@/lib/i18n";
import { DEFAULT_LOCALE, INTL_LOCALE, type Locale } from "@/lib/i18n/locale";
import { formatEuro } from "@/lib/money/format";
import { formatCalendarDate, formatWeekday } from "@/lib/time/format";
import { formatMeasuredQty, formatNumber } from "@/lib/units/format";
import type { QuantityUnit } from "@/lib/units/convert";
import type { AvtOutput, ItemsOutput } from "@/server/reports/output";

// Pure helpers of the report screens and of the "Ieri" tile (M22 plan §3.1.12, §3.6): formatting, labels, which empty state applies. The
// components only render what these return; the database did every sum, ratio, delta and range, and nothing here computes a euro value.

const MINUS = "−";
const NBSP = " ";

const oneDecimal = new Map<Locale, Intl.NumberFormat>();
function pctNumber(value: number, locale: Locale): string {
  let formatter = oneDecimal.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(INTL_LOCALE[locale], {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
      useGrouping: "always",
    });
    oneDecimal.set(locale, formatter);
  }
  return formatter.format(Math.abs(value));
}

/** "+" or the real minus sign, nothing for zero. */
const sign = (value: number): string => (value > 0 ? "+" : value < 0 ? MINUS : "");

/** "+162,1 %" (the real minus sign for a fall); nothing when the previous value was 0 or unknown. */
export function formatDeltaPct(pct: number | null, locale: Locale = DEFAULT_LOCALE): string {
  if (pct === null) return "";
  return `${sign(pct)}${pctNumber(pct, locale)}${NBSP}%`;
}

/** "+3 (+150,0 %)", "−2,5", "0": the absolute change, then the percentage when there is one. */
export function formatDelta(
  abs: number,
  pct: number | null,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const amount = `${sign(abs)}${formatNumber(Math.abs(abs), locale)}`;
  return pct === null ? amount : `${amount} (${formatDeltaPct(pct, locale)})`;
}

/** "in più" / "in meno": the words next to a delta, so colour is never the only signal; nothing for zero. */
export function deltaWords(abs: number, locale: Locale = DEFAULT_LOCALE): string {
  if (abs > 0) return t("report.delta.more", {}, locale);
  if (abs < 0) return t("report.delta.less", {}, locale);
  return "";
}

export type HourRow = { hour: number; label: string; covers: number };

/** The covers of each local hour; by default the hours with none are left out (the phone shows only the evening). */
export function hourRows(coversByHour: readonly number[], hideZero = true): HourRow[] {
  if (coversByHour.length !== 24) throw new RangeError("hourRows: expected 24 hours");
  return coversByHour
    .map((covers, hour) => ({ hour, label: String(hour).padStart(2, "0"), covers }))
    .filter((row) => !hideZero || row.covers > 0);
}

/** The short weekday of an index 0 (Monday) to 6 (Sunday). */
export function weekdayLabel(index: number, locale: Locale = DEFAULT_LOCALE): string {
  if (!Number.isInteger(index) || index < 0 || index > 6) {
    throw new RangeError("weekdayLabel: expected an index from 0 (Monday) to 6 (Sunday)");
  }
  // 2026-11-02 is a Monday.
  return formatWeekday(`2026-11-${String(2 + index).padStart(2, "0")}`, locale).replace(/\.$/, "");
}

export type WeekdayRow = { index: number; label: string; covers: number };

/** Seven rows, Monday first. */
export function weekdayRows(
  coversByWeekday: readonly number[],
  locale: Locale = DEFAULT_LOCALE,
): WeekdayRow[] {
  if (coversByWeekday.length !== 7) throw new RangeError("weekdayRows: expected 7 days");
  return coversByWeekday.map((covers, index) => ({
    index,
    label: weekdayLabel(index, locale),
    covers,
  }));
}

const dayFormatters = new Map<Locale, Intl.DateTimeFormat>();

/** "mercoledì 4 novembre" from a business date. */
export function businessDayTitle(isoDate: string, locale: Locale = DEFAULT_LOCALE): string {
  formatCalendarDate(isoDate, locale); // refuses a date that is not real
  let formatter = dayFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      timeZone: "UTC",
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    dayFormatters.set(locale, formatter);
  }
  return formatter.format(new Date(`${isoDate}T00:00:00Z`)).replace(",", "");
}

/** "Ieri · mercoledì 4 novembre". */
export function yesterdayTitle(isoDate: string, locale: Locale = DEFAULT_LOCALE): string {
  return t("report.yesterday.title", { day: businessDayTitle(isoDate, locale) }, locale);
}

/** "sui piatti con costo noto (71,59 € di 119,13 €)": the food cost % is on the dishes whose cost is known. */
export function yesterdayHint(
  costedRevenueNetEur: number,
  revenueNetEur: number,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return t(
    "report.yesterday.hint",
    { costed: formatEuro(costedRevenueNetEur, locale), total: formatEuro(revenueNetEur, locale) },
    locale,
  );
}

/** "Provvisorio: 1 giorno su 7 non ancora chiuso"; null when every day is final. */
export function provisionalNote(
  daysFinal: number,
  days: number,
  locale: Locale = DEFAULT_LOCALE,
): string | null {
  const open = days - daysFinal;
  if (open <= 0) return null;
  const key = open === 1 ? "report.provisional.one" : "report.provisional.other";
  return t(key, { count: open, days }, locale);
}

const shortDay = new Map<Locale, Intl.DateTimeFormat>();
/** "28 ott". */
function dayAndMonth(isoDate: string, locale: Locale): string {
  formatCalendarDate(isoDate, locale);
  let formatter = shortDay.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      timeZone: "UTC",
      day: "numeric",
      month: "short",
    });
    shortDay.set(locale, formatter);
  }
  return formatter.format(new Date(`${isoDate}T00:00:00Z`)).replace(/\./g, "");
}

/** "Totale cassa non inserito: 28 ott, 1 nov"; null when there is none. */
export function missingRegisterText(
  dates: readonly string[],
  locale: Locale = DEFAULT_LOCALE,
): string | null {
  if (dates.length === 0) return null;
  return t(
    "report.missingRegister",
    { dates: dates.map((d) => dayAndMonth(d, locale)).join(", ") },
    locale,
  );
}

const dayMonth = (isoDate: string, locale: Locale) =>
  formatCalendarDate(isoDate, locale).slice(0, 5);

/** "Settimana dal 02/11 all'08/11": Italian says "all'" before 8, 11 and 18. */
export function unmappedWeekLabel(
  from: string,
  to: string,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const elided = [8, 11, 18].includes(Number(to.slice(8, 10)));
  const key: MessageKey = elided ? "report.week.toElided" : "report.week.to";
  return t(key, { from: dayMonth(from, locale), to: dayMonth(to, locale) }, locale);
}

/** "Inventario mensile del 30/11 · Cella (demo)": one option of the count picker. */
export function countOptionLabel(
  closedAt: string,
  locationName: string,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return t(
    "report.countOption",
    { date: dayMonth(closedAt.slice(0, 10), locale), location: locationName },
    locale,
  );
}

type Status = ItemsOutput["rows"][number]["status"];

/** The badge of an item row; null for a plate whose cost is fully known. */
export function itemStatusLabel(status: Status, locale: Locale = DEFAULT_LOCALE): string | null {
  if (status === "costed") return null;
  return t(`report.status.${status}` as MessageKey, {}, locale);
}

type AvtRow = AvtOutput["rows"][number];

/** "Manzo (demo) · consumato 5,8 kg · da ricetta 5,0 kg · scarti registrati 0,2 kg · differenza +0,8 kg · 9,60 €". */
export function avtRowText(row: AvtRow, locale: Locale = DEFAULT_LOCALE): string {
  const unit = row.baseUnit as QuantityUnit;
  const qty = (value: number) => formatMeasuredQty(value, unit, locale);
  const variance = `${sign(row.varianceQty)}${qty(Math.abs(row.varianceQty))}`;
  const parts = [
    row.name,
    t("report.avt.consumed", { qty: qty(row.actualQty) }, locale),
    t("report.avt.recipe", { qty: qty(row.theoreticalQty) }, locale),
    t("report.avt.waste", { qty: qty(row.wasteQty) }, locale),
    t("report.avt.variance", { qty: variance }, locale),
  ];
  if (row.varianceEur !== null) parts.push(formatEuro(row.varianceEur, locale));
  return parts.join(" · ");
}

export type EmptyKey =
  | "noTablesYesterday"
  | "avtNoCount"
  | "avtNoOpening"
  | "avtManyLocations"
  | "unmappedNone"
  | "reserved";

/** The text of an empty state or note of the report screens. */
export function emptyText(key: EmptyKey, locale: Locale = DEFAULT_LOCALE): string {
  return t(`report.empty.${key}` as MessageKey, {}, locale);
}
