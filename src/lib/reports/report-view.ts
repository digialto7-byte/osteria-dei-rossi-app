import { t, type MessageKey } from "@/lib/i18n";
import { DEFAULT_LOCALE, INTL_LOCALE, type Locale } from "@/lib/i18n/locale";
import { differenceFigure } from "@/lib/day-close/day-close-view";
import { formatEuro } from "@/lib/money/format";
import { formatCalendarDate, formatWeekday } from "@/lib/time/format";
import { venueDate } from "@/lib/time/venue-date";
import { formatMeasuredQty, formatNumber } from "@/lib/units/format";
import { formatStockQty } from "@/lib/stock/stock-view";
import type { QuantityUnit } from "@/lib/units/convert";
import type { WasteCosts } from "@/server/stock/types";
import type { AvtOutput, ItemsOutput } from "@/server/reports/output";
import type { DiscardsOutput } from "@/server/push/output";

// Pure helpers of the report screens and of the "Ieri" tile (M22 plan §3.1.12, §3.6): formatting, labels, which empty state applies. The
// components only render what these return; the database did every sum, ratio, delta and range, and nothing here computes a euro value.

/** Who may open the report screen (the database enforces it too): the owner and the admin. */
export function canReadReports(role: string | undefined): boolean {
  return role === "owner" || role === "admin";
}

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

/** "+2,1 pt (+7,3 %)": the change of a percentage is in percentage points ("pt", "pp" in English), then the relative change when there is one. */
export function formatDeltaPoints(
  abs: number,
  pct: number | null,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const points = `${sign(abs)}${pctNumber(abs, locale)}${NBSP}${t("report.delta.points", {}, locale)}`;
  return pct === null ? points : `${points} (${formatDeltaPct(pct, locale)})`;
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

const weekdayLong = new Map<Locale, Intl.DateTimeFormat>();

/** "mercoledì scorso" from the business date of the comparison day (the same weekday a week before). */
export function compareLabel(isoDate: string, locale: Locale = DEFAULT_LOCALE): string {
  formatCalendarDate(isoDate, locale);
  let formatter = weekdayLong.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(INTL_LOCALE[locale], { timeZone: "UTC", weekday: "long" });
    weekdayLong.set(locale, formatter);
  }
  const date = new Date(`${isoDate}T00:00:00Z`);
  // Italian: "domenica scorsa" (feminine), every other day "scorso".
  const key =
    date.getUTCDay() === 0 ? "report.yesterday.compareSunday" : "report.yesterday.compare";
  return t(key, { weekday: formatter.format(date) }, locale);
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
export function dayAndMonth(isoDate: string, locale: Locale = DEFAULT_LOCALE): string {
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
    { date: dayMonth(venueDate(new Date(closedAt)), locale), location: locationName },
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

type DiscardsRow = DiscardsOutput["rows"][number];
type DiscardsFigures = Pick<
  DiscardsRow,
  "batchesDiscarded" | "batchesPushed" | "portionsDiscarded" | "valueEur" | "unvaluedCount"
>;

const plural = (base: string, count: number, locale: Locale): string =>
  t(
    `${base}.${count === 1 ? "one" : "other"}` as MessageKey,
    { count: formatNumber(count, locale) },
    locale,
  );

/** "1 era in evidenza", "0 in evidenza": how many discarded batches had a plate pushed (the database's flag). */
function pushedText(pushed: number, locale: Locale): string {
  const key =
    pushed === 0
      ? "report.discards.pushed.none"
      : pushed === 1
        ? "report.discards.pushed.one"
        : "report.discards.pushed.other";
  return t(key as MessageKey, { count: formatNumber(pushed, locale) }, locale);
}

/** The value of the discarded portions; costs the database did not know are never counted as zero. */
function discardsValue(figures: DiscardsFigures, locale: Locale): string {
  if (figures.unvaluedCount === 0) return formatEuro(figures.valueEur, locale);
  if (figures.valueEur === 0) return t("report.discards.valueUnknown", {}, locale);
  return t(
    "report.discards.valuePartial",
    { amount: formatEuro(figures.valueEur, locale), count: figures.unvaluedCount },
    locale,
  );
}

/** "Spezzatino · durata 48 h · 1 lotto scartato, 1 era in evidenza · 3 porzioni · 8,14 €": one batch recipe of the weekly discards report. */
export function discardsRowText(row: DiscardsRow, locale: Locale = DEFAULT_LOCALE): string {
  return t(
    "report.discards.row",
    {
      name: row.name,
      hours: row.shelfLifeHours,
      batches: plural("report.discards.batches", row.batchesDiscarded, locale),
      pushed: pushedText(row.batchesPushed, locale),
      portions: plural("dashboard.stock.portions", row.portionsDiscarded, locale),
      value: discardsValue(row, locale),
    },
    locale,
  );
}

/** The week in one line: "2 lotti scartati, 1 era in evidenza · 8 porzioni · 15,64 €". */
export function discardsTotalsText(
  totals: DiscardsOutput["totals"],
  locale: Locale = DEFAULT_LOCALE,
): string {
  return [
    `${plural("report.discards.batches", totals.batchesDiscarded, locale)}, ${pushedText(totals.batchesPushed, locale)}`,
    plural("dashboard.stock.portions", totals.portionsDiscarded, locale),
    discardsValue(totals, locale),
  ].join(" · ");
}

export type EmptyKey =
  | "noTablesYesterday"
  | "avtNoCount"
  | "avtNoOpening"
  | "avtManyLocations"
  | "unmappedNone"
  | "reserved"
  | "discardsNone";

/** The text of an empty state or note of the report screens. */
export function emptyText(key: EmptyKey, locale: Locale = DEFAULT_LOCALE): string {
  return t(`report.empty.${key}` as MessageKey, {}, locale);
}

/** "ottobre 2026" from "2026-10": the month in words (format only). */
export function monthLabel(month: string, locale: Locale = DEFAULT_LOCALE): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new RangeError("monthLabel: expected YYYY-MM");
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(new Date(`${month}-01T00:00:00Z`));
}

export type PackKind = "count" | "eur" | "points" | "pct";

/** The change of a pack figure in words and figures; the database computed the numbers. */
function packChange(
  delta: { abs: number; pct: number | null },
  kind: PackKind,
  locale: Locale,
): string {
  const figure =
    kind === "count"
      ? formatDelta(delta.abs, delta.pct, locale)
      : kind === "eur"
        ? differenceFigure(delta.abs, delta.pct, locale)
        : kind === "points"
          ? formatDeltaPoints(delta.abs, delta.pct, locale)
          : formatDeltaPct(delta.pct, locale);
  return [figure, deltaWords(delta.abs, locale)].filter((part) => part !== "").join(" ");
}

/** "Coperti 312 · settembre 2026 290 · +22 (+7,6 %) in più": value, previous month, change (left out when the API sent none). */
export function packFigureLine(
  figure: {
    label: string;
    current: string;
    previous: string;
    delta: { abs: number; pct: number | null } | null;
    kind: PackKind;
  },
  previousMonth: string,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const parts = [`${figure.label} ${figure.current}`, `${previousMonth} ${figure.previous}`];
  if (figure.delta !== null) parts.push(packChange(figure.delta, figure.kind, locale));
  return parts.join(" · ");
}

/** "Inventario del 31/10/2026 rispetto al 30/09/2026 · Cella (demo)": the two counts the variance lies between, by their Rome dates. */
export function packCountPair(avt: AvtOutput, locale: Locale = DEFAULT_LOCALE): string {
  const day = (closedAt: string) => formatCalendarDate(venueDate(new Date(closedAt)), locale);
  return t(
    "pack.variance.pair",
    {
      close: day(avt.count.closedAt),
      open: day(avt.openingCount.closedAt),
      location: avt.count.locationName,
    },
    locale,
  );
}

type WasteReason = WasteCosts["reasons"][number];

const wasteValue = (value: number | null, locale: Locale) =>
  value === null ? t("pack.waste.unknown", {}, locale) : formatEuro(value, locale);

/** "Manzo (demo) · 1,2 kg · 14,40 €"; a value the database could not compute says "costo non noto", never 0,00 €. */
export function wasteRawLineText(
  line: WasteReason["lines"][number],
  locale: Locale = DEFAULT_LOCALE,
): string {
  return [
    line.ingredientName,
    formatStockQty(line.qty, line.baseUnit, locale),
    wasteValue(line.valueEur, locale),
  ].join(" · ");
}

/** "Spezzatino (demo) · 3 porzioni · 12,00 € (+1 non valorizzata)": a prepared batch thrown away. */
export function wasteBatchLineText(
  line: WasteReason["batchLines"][number],
  locale: Locale = DEFAULT_LOCALE,
): string {
  const value =
    line.valueEur !== null && line.unvaluedCount > 0
      ? t(
          `stock.costs.batchPartial.${line.unvaluedCount === 1 ? "one" : "other"}`,
          { value: formatEuro(line.valueEur, locale), count: line.unvaluedCount },
          locale,
        )
      : wasteValue(line.valueEur, locale);
  return [line.recipeName, plural("dashboard.stock.portions", line.portions, locale), value].join(
    " · ",
  );
}
