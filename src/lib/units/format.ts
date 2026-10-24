import { DEFAULT_LOCALE, INTL_LOCALE, type Locale } from "@/lib/i18n/locale";
import type { QuantityUnit } from "./convert";

const MAX_DISPLAY_DECIMALS = 3;
const formatters = new Map<Locale, Intl.NumberFormat>();
const measuredFormatters = new Map<Locale, Intl.NumberFormat>();

function quantityFormatter(locale: Locale): Intl.NumberFormat {
  let formatter = formatters.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(INTL_LOCALE[locale], {
      maximumFractionDigits: MAX_DISPLAY_DECIMALS,
      useGrouping: "always",
    });
    formatters.set(locale, formatter);
  }
  return formatter;
}

/** Formats a number with the quantity rules (Italian decimals, at most 3 decimals), without a unit. */
export function formatNumber(value: number, locale: Locale = DEFAULT_LOCALE): string {
  return quantityFormatter(locale).format(value);
}

/** Formats a quantity for display, e.g. 0.5 kg → "0,5 kg" (it). `conf` counts whole packs. */
export function formatQty(
  qty: number,
  unit: QuantityUnit,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return `${quantityFormatter(locale).format(qty)}\u00a0${unit}`;
}

/**
 * A measured quantity with at least one decimal, as the PRD writes it (5,0 kg; 12,3 kg). Used where a quantity is a
 * reading or a requirement rather than a count of packs: still at most 3 decimals, the unit after a no-break space.
 */
export function formatMeasuredQty(
  qty: number,
  unit: QuantityUnit,
  locale: Locale = DEFAULT_LOCALE,
): string {
  let formatter = measuredFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(INTL_LOCALE[locale], {
      minimumFractionDigits: 1,
      maximumFractionDigits: MAX_DISPLAY_DECIMALS,
      useGrouping: "always",
    });
    measuredFormatters.set(locale, formatter);
  }
  return `${formatter.format(qty)}\u00a0${unit}`;
}
