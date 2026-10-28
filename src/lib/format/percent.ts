import { DEFAULT_LOCALE, INTL_LOCALE, type Locale } from "@/lib/i18n/locale";

const formatters = new Map<Locale, Intl.NumberFormat>();

/** A rate (0.1) as the venue reads it ("10%", "7,5%"); `null` (no lines to rate) is a dash. */
export function formatPercent(rate: number | null, locale: Locale = DEFAULT_LOCALE): string {
  if (rate === null) return "—";
  let formatter = formatters.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(INTL_LOCALE[locale], {
      style: "percent",
      maximumFractionDigits: 1,
    });
    formatters.set(locale, formatter);
  }
  return formatter.format(rate);
}

const valueFormatters = new Map<Locale, Intl.NumberFormat>();

/** A figure that is already a percentage (28.28) with two decimals, without the sign: "28,28". */
export function formatPercentValue(value: number, locale: Locale = DEFAULT_LOCALE): string {
  let formatter = valueFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(INTL_LOCALE[locale], {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    valueFormatters.set(locale, formatter);
  }
  return formatter.format(value);
}
