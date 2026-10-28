import { formatPercentValue } from "@/lib/format/percent";
import { t, tn, type MessageKey } from "@/lib/i18n";
import { DEFAULT_LOCALE, INTL_LOCALE, type Locale } from "@/lib/i18n/locale";
import { formatEuro } from "@/lib/money/format";
import { formatCalendarDate } from "@/lib/time/format";
import { formatNumber } from "@/lib/units/format";
import type { AdminDashboard, OwnerDashboard } from "@/server/dashboard/output";
import { STOCK_REASON_CODES, reasonLabel, type StockReasonCode } from "@/server/stock/reasons";

// Pure helpers of the owner dashboard (plan §3.4): number and date formatting, labels, which empty state applies, the order
// of the tiles. The components only render what these return, and the server did every sum, rank and window.

export type DashboardRole = "owner" | "admin";
export type TileKey =
  | "todayLists"
  | "plates"
  | "foodCost"
  | "payables"
  | "stockAtRisk"
  | "waste"
  | "priceVariance"
  | "fixedCosts"
  | "comingSoon";
export type ComingSoonKey = AdminDashboard["comingSoon"][number];
type Tiles = Partial<OwnerDashboard["tiles"]>;

/** `1.234,50 €`, with the no-break space the Intl formatter puts before the sign. */
export const formatEur = (amount: number, locale: Locale = DEFAULT_LOCALE): string =>
  formatEuro(amount, locale);

/** `28,28 %`: two decimals, then a no-break space and the sign. */
export function formatPct(value: number, locale: Locale = DEFAULT_LOCALE): string {
  return `${formatPercentValue(value, locale)} %`;
}

/** A quantity with its unit after a no-break space (`2 kg`), at most three decimals. */
export function qtyText(qty: number, unit: string, locale: Locale = DEFAULT_LOCALE): string {
  return `${formatNumber(qty, locale)} ${unit}`;
}

/** "Scaduta da 5 giorni", "Scade oggi", "Scade tra 7 giorni": the day count is the server's. */
export function dueWords(
  daysToDue: number,
  overdue: boolean,
  locale: Locale = DEFAULT_LOCALE,
): string {
  if (overdue) return tn("dashboard.due.overdue", Math.abs(daysToDue), locale);
  if (daysToDue === 0) return t("dashboard.due.today", {}, locale);
  return tn("dashboard.due.soon", daysToDue, locale);
}

const dayMonth = (isoDate: string, locale: Locale) =>
  formatCalendarDate(isoDate, locale).slice(0, 5);

/** "Settimana dal 09/11 al 15/11" from the two calendar dates of the server's ISO week. */
export function weekLabel(from: string, to: string, locale: Locale = DEFAULT_LOCALE): string {
  return t(
    "dashboard.waste.week",
    { from: dayMonth(from, locale), to: dayMonth(to, locale) },
    locale,
  );
}

const monthFormatters = new Map<Locale, Intl.DateTimeFormat>();

/** "novembre 2026" from the first day of a fixed-cost month. */
export function monthLabel(periodMonth: string, locale: Locale = DEFAULT_LOCALE): string {
  formatCalendarDate(periodMonth, locale); // refuses a date that is not real
  let formatter = monthFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      timeZone: "UTC",
      month: "long",
      year: "numeric",
    });
    monthFormatters.set(locale, formatter);
  }
  return formatter.format(new Date(`${periodMonth}T00:00:00Z`));
}

/** The label of a waste reason code; a code this build does not know is shown as it is. */
export function wasteReasonLabel(code: string, locale: Locale = DEFAULT_LOCALE): string {
  return (STOCK_REASON_CODES as readonly string[]).includes(code)
    ? reasonLabel(code as StockReasonCode, locale)
    : code;
}

export function comingSoonLabel(key: ComingSoonKey, locale: Locale = DEFAULT_LOCALE): string {
  return t(`dashboard.comingSoon.${key}`, {}, locale);
}

const OWNER_ORDER: readonly TileKey[] = [
  "todayLists",
  "plates",
  "foodCost",
  "payables",
  "stockAtRisk",
  "waste",
  "priceVariance",
  "fixedCosts",
  "comingSoon",
];
const ADMIN_ORDER: readonly TileKey[] = [
  "plates",
  "foodCost",
  "payables",
  "stockAtRisk",
  "waste",
  "comingSoon",
];

/** The tiles of a role in the order they appear (plan §3.4). */
export const tileOrder = (role: DashboardRole): readonly TileKey[] =>
  role === "owner" ? OWNER_ORDER : ADMIN_ORDER;

/**
 * The message key of the empty text a tile shows, or null when it has content (or when the tile is not in `tiles`, as the
 * owner-only tiles are not in the admin's). A week with only unpriced waste is NOT empty and never shows "0,00" (M12
 * rule): it says the value is not available.
 */
export function tileEmpty(key: TileKey, tiles: Tiles): MessageKey | null {
  switch (key) {
    case "todayLists": {
      const tile = tiles.todayLists;
      return tile && tile.prep.length === 0 && tile.purchase.length === 0
        ? "dashboard.empty.todayLists"
        : null;
    }
    case "plates": {
      const tile = tiles.plates;
      if (!tile || tile.worst.length > 0) return null;
      return tile.incompleteCount > 0
        ? "dashboard.empty.platesIncomplete"
        : "dashboard.empty.plates";
    }
    case "foodCost":
      return tiles.foodCost && tiles.foodCost.overallPct === null
        ? "dashboard.empty.foodCost"
        : null;
    case "payables": {
      const tile = tiles.payables;
      return tile && tile.overdue.count === 0 && tile.dueSoon.count === 0
        ? "dashboard.empty.payables"
        : null;
    }
    case "stockAtRisk": {
      const tile = tiles.stockAtRisk;
      return tile &&
        tile.belowMin.count === 0 &&
        tile.expiringLots.count === 0 &&
        tile.expiringBatches.count === 0
        ? "dashboard.empty.stockAtRisk"
        : null;
    }
    case "waste": {
      const tile = tiles.waste;
      if (!tile || tile.valueEur > 0) return null;
      return tile.unvaluedCount > 0 ? "dashboard.empty.wasteUnvalued" : "dashboard.empty.waste";
    }
    case "priceVariance":
      return tiles.priceVariance && tiles.priceVariance.count === 0
        ? "dashboard.empty.priceVariance"
        : null;
    case "fixedCosts":
      return tiles.fixedCosts && tiles.fixedCosts.reason === "no_fixed_costs"
        ? "dashboard.empty.fixedCosts"
        : null;
    case "comingSoon":
      return null;
  }
}
