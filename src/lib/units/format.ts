import { DEFAULT_LOCALE, INTL_LOCALE, type Locale } from "@/lib/i18n/locale";
import type { MeasureUnit } from "./units";

const MAX_DISPLAY_DECIMALS = 3;
const formatters = new Map<Locale, Intl.NumberFormat>();

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

/** Formats a quantity for display, e.g. 0.5 kg → "0,5 kg" (it). */
export function formatQty(qty: number, unit: MeasureUnit, locale: Locale = DEFAULT_LOCALE): string {
  return `${quantityFormatter(locale).format(qty)} ${unit}`;
}
