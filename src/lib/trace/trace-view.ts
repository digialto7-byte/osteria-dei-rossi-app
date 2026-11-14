import { formatCount } from "@/lib/batches/batch-view";
import { t, tn } from "@/lib/i18n";
import { DEFAULT_LOCALE, INTL_LOCALE, type Locale } from "@/lib/i18n/locale";
import { dayAndMonth } from "@/lib/reports/report-view";
import { formatStockQty } from "@/lib/stock/stock-view";
import { VENUE_TIME_ZONE, formatTime } from "@/lib/time/format";
import type { QuantityUnit } from "@/lib/units/convert";

export { canTrace } from "./trace-access";

// Words and formats of the trace screens (P2-2 plan §3.8, spec docs/ux/p2-2-trace-sell-through.md). Formatting only: every number, order,
// total and date comes with the API reply; nothing here adds, compares or divides one. Times are Europe/Rome.

/** The trace pages' addresses. */
export const lotHref = (lotId: string) => `/tracciabilita/lotto/${lotId}`;
export const batchHref = (batchId: string) => `/tracciabilita/produzione/${batchId}`;
export const lineHref = (lineId: string) => `/tracciabilita/piatto/${lineId}`;

/** "13 nov". */
export const formatShortDate = (isoDate: string, locale: Locale = DEFAULT_LOCALE): string =>
  dayAndMonth(isoDate, locale);

const dateTimeFormatters = new Map<Locale, Intl.DateTimeFormat>();

/** "13 nov, 12:40": an instant as a short day and the clock time in Europe/Rome. */
export function formatShortDateTime(instant: string, locale: Locale = DEFAULT_LOCALE): string {
  let formatter = dateTimeFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      timeZone: VENUE_TIME_ZONE,
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    dateTimeFormatters.set(locale, formatter);
  }
  const parts = formatter.formatToParts(new Date(instant));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const day = `${part("day")} ${part("month").replace(/\./g, "")}`;
  return `${day}, ${part("hour")}:${part("minute")}`;
}

/** "12:40–14:55". */
export function formatTimeRange(
  first: string,
  last: string,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return `${formatTime(new Date(first), locale)}–${formatTime(new Date(last), locale)}`;
}

/** "1,5 kg", "−0,5 kg": a quantity in the unit the reply names. */
export const qtyText = (qty: number, unit: string, locale: Locale = DEFAULT_LOCALE): string =>
  formatStockQty(qty, unit as QuantityUnit, locale);

/** "12 porz.". */
export const portionsShort = (count: number, locale: Locale = DEFAULT_LOCALE): string =>
  t("trace.portions", { count: formatCount(count, locale) }, locale);

/** The count of plates: "1 piatto", "14 piatti". */
export const platesText = (count: number, locale: Locale = DEFAULT_LOCALE): string =>
  tn("trace.plate", count, locale);

/** The code of a lot, or the words for one with none (the same words as the stock screen). */
export const lotCodeText = (code: string | null, locale: Locale = DEFAULT_LOCALE): string =>
  code ?? t("stock.lot.noCode", {}, locale);

/** "Farina Demo · Fornitore Demo 1 · consegna 13 nov". */
export function lotMetaLine(
  lot: { ingredient: { name: string }; supplier: { name: string }; receivedOn: string },
  locale: Locale = DEFAULT_LOCALE,
): string {
  return [
    lot.ingredient.name,
    lot.supplier.name,
    t("trace.delivered", { date: formatShortDate(lot.receivedOn, locale) }, locale),
  ].join(" · ");
}

/** "Farina Demo · 6 kg · lotto L-2311-A · Fornitore Demo 1 · consegna 13 nov": a lot reached from a batch or a plate. */
export function reachedLotText(
  input: {
    lead: string;
    qty?: string | undefined;
    lot: { lotCode: string | null; receivedOn: string; supplier: { name: string } };
  },
  locale: Locale = DEFAULT_LOCALE,
): string {
  const { lead, qty, lot } = input;
  return [
    lead,
    ...(qty ? [qty] : []),
    lot.lotCode === null
      ? t("stock.lot.noCode", {}, locale)
      : t("trace.input.lot", { code: lot.lotCode }, locale),
    lot.supplier.name,
    t("trace.delivered", { date: formatShortDate(lot.receivedOn, locale) }, locale),
  ].join(" · ");
}

/** "31 vendute, 2 scartate, 7 rimaste". */
export function outcomeText(
  outcome: { sold: number; wasted: number; remaining: number },
  locale: Locale = DEFAULT_LOCALE,
): string {
  const word = (base: "sold" | "wasted" | "left", n: number) =>
    t(`trace.${base}.${n === 1 ? "one" : "other"}`, { count: formatCount(n, locale) }, locale);
  return [
    word("sold", outcome.sold),
    word("wasted", outcome.wasted),
    word("left", outcome.remaining),
  ].join(", ");
}

export interface PlateGroup {
  businessDate: string;
  menuItemId: string;
  name: string;
  lines: number;
  portions: number;
  firstAt: string;
  lastAt: string;
  via: "batch" | "direct";
}

/** "14 nov · Lasagne Demo · 14 piatti (14 porz.) · 12:40–14:55", and " · senza preparazione" for a raw ingredient used directly. */
export function plateLine(plate: PlateGroup, locale: Locale = DEFAULT_LOCALE): string {
  const parts = [
    formatShortDate(plate.businessDate, locale),
    plate.name,
    `${platesText(plate.lines, locale)} (${portionsShort(plate.portions, locale)})`,
    formatTimeRange(plate.firstAt, plate.lastAt, locale),
  ];
  if (plate.via === "direct") parts.push(t("trace.noPrep", {}, locale));
  return parts.join(" · ");
}

/** "13 nov · 21:14 · Tavolo 7 · Lasagne Demo · 1 porz.": one served plate of the day search. */
export function lineText(
  line: { menuItemName: string; tableName: string; firedAt: string; portions: number },
  locale: Locale = DEFAULT_LOCALE,
): string {
  return t(
    "trace.line.row",
    {
      date: formatShortDateTime(line.firedAt, locale).split(", ")[0]!,
      time: formatTime(new Date(line.firedAt), locale),
      table: line.tableName,
      dish: line.menuItemName,
      portions: portionsShort(line.portions, locale),
    },
    locale,
  );
}

/** "14 nov · 21:14 · Tavolo 7 · 1 porz.": the line under a plate's name. */
export function lineMeta(
  line: { tableName: string; firedAt: string; portions: number },
  locale: Locale = DEFAULT_LOCALE,
): string {
  return t(
    "trace.line.meta",
    {
      date: formatShortDateTime(line.firedAt, locale).split(", ")[0]!,
      time: formatTime(new Date(line.firedAt), locale),
      table: line.tableName,
      portions: portionsShort(line.portions, locale),
    },
    locale,
  );
}

export interface LotFilters {
  q: string;
  ingredientId: string;
  supplierId: string;
  from: string;
  to: string;
}

/**
 * The query string of a lot search: exactly what was typed or chosen, trimmed, and nothing for an empty field. Null when there is no code,
 * ingredient or supplier: the dates alone do not search (the API would answer 400).
 */
export function lotSearchQuery(filters: LotFilters): string | null {
  const q = filters.q.trim();
  if (q === "" && filters.ingredientId === "" && filters.supplierId === "") return null;
  const params = new URLSearchParams();
  if (q !== "") params.set("q", q);
  if (filters.ingredientId !== "") params.set("ingredientId", filters.ingredientId);
  if (filters.supplierId !== "") params.set("supplierId", filters.supplierId);
  if (filters.from !== "") params.set("from", filters.from);
  if (filters.to !== "") params.set("to", filters.to);
  return params.toString();
}
