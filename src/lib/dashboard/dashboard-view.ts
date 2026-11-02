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
  | "pushList"
  | "yesterday"
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

/** How many rows of a capped list are not shown ("e altri 2"): the server's count minus the rows it sent, never negative. */
export const moreCount = (total: number, shown: number): number => Math.max(0, total - shown);

/** "3,5 porzioni", "1 porzione": the ledger counts portions to four decimals, so the number goes through the formatter. */
export function portionsText(portions: number, locale: Locale = DEFAULT_LOCALE): string {
  return t(
    portions === 1 ? "dashboard.stock.portions.one" : "dashboard.stock.portions.other",
    { count: formatNumber(portions, locale) },
    locale,
  );
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
  "pushList",
  "yesterday",
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
  "pushList",
  "yesterday",
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
    case "pushList":
      return tiles.pushList && tiles.pushList.count === 0 ? "dashboard.empty.pushList" : null;
    case "yesterday": {
      const tile = tiles.yesterday;
      return tile && tile.final && tile.covers === 0 ? "report.empty.noTablesYesterday" : null;
    }
    case "comingSoon":
      return null;
  }
}

/**
 * The one line a collapsed tile shows (M25b, plan §3.1.8): the tile's empty text when it is empty, else a template filled only with the
 * server's values and the formatters above. It adds, subtracts and divides nothing. Null for a tile that is not in `tiles` (the admin has no
 * owner-only tile) and for "comingSoon".
 */
export function tileHeadline(
  key: TileKey,
  tiles: Tiles,
  locale: Locale = DEFAULT_LOCALE,
): string | null {
  const empty = tileEmpty(key, tiles);
  if (empty) return t(empty, {}, locale);
  switch (key) {
    case "pushList":
      return tiles.pushList
        ? t("dashboard.headline.pushList", { count: tiles.pushList.count }, locale)
        : null;
    case "yesterday": {
      const tile = tiles.yesterday;
      if (!tile) return null;
      const line = t(
        "dashboard.headline.yesterday",
        { covers: tile.covers, revenue: formatEur(tile.revenueNetEur, locale) },
        locale,
      );
      return tile.final ? line : `${line} · ${t("dashboard.headline.provisional", {}, locale)}`;
    }
    case "todayLists": {
      const tile = tiles.todayLists;
      return tile
        ? t(
            "dashboard.headline.todayLists",
            { prep: tile.prepCount, purchase: tile.purchaseCount },
            locale,
          )
        : null;
    }
    case "plates": {
      const first = tiles.plates?.worst[0];
      if (!first) return null;
      return first.status === "below_target"
        ? t("dashboard.headline.platesBelow", { name: first.name }, locale)
        : t("dashboard.headline.platesOk", {}, locale);
    }
    case "foodCost":
      return tiles.foodCost?.overallPct == null
        ? null
        : t(
            "dashboard.headline.foodCost",
            { pct: formatPct(tiles.foodCost.overallPct, locale) },
            locale,
          );
    case "payables": {
      const tile = tiles.payables;
      return tile
        ? t(
            "dashboard.headline.payables",
            {
              overdue: tile.overdue.count,
              amount: formatEur(tile.overdue.amountEur, locale),
              soon: tile.dueSoon.count,
            },
            locale,
          )
        : null;
    }
    case "stockAtRisk": {
      const tile = tiles.stockAtRisk;
      return tile
        ? t(
            "dashboard.headline.stockAtRisk",
            {
              below: tile.belowMin.count,
              lots: tile.expiringLots.count,
              batches: tile.expiringBatches.count,
            },
            locale,
          )
        : null;
    }
    case "waste":
      return tiles.waste
        ? t("dashboard.headline.waste", { value: formatEur(tiles.waste.valueEur, locale) }, locale)
        : null;
    case "priceVariance":
      return tiles.priceVariance
        ? t("dashboard.headline.priceVariance", { count: tiles.priceVariance.count }, locale)
        : null;
    case "fixedCosts": {
      const tile = tiles.fixedCosts;
      if (!tile) return null;
      // Follows `reason`, like the open tile: with no sales the costs exist but cannot be shared out over plates.
      return tile.reason === "no_sales" || tile.monthlyTotalEur === null
        ? t("dashboard.fixedCosts.unallocated", {}, locale)
        : t(
            "dashboard.headline.fixedCosts",
            { total: formatEur(tile.monthlyTotalEur, locale) },
            locale,
          );
    }
    case "comingSoon":
      return null;
  }
}
