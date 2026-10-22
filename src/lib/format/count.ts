import { DEFAULT_LOCALE, INTL_LOCALE, type Locale } from "@/lib/i18n/locale";

const formatters = new Map<Locale, Intl.NumberFormat>();

/**
 * A whole count with thousands separators ("1.234"). `useGrouping: "always"`: it-IT's default
 * leaves four-digit numbers bare ("1234"), and the venue reads 1.234.
 */
export function formatCount(value: number, locale: Locale = DEFAULT_LOCALE): string {
  let formatter = formatters.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(INTL_LOCALE[locale], {
      useGrouping: "always",
      maximumFractionDigits: 0,
    });
    formatters.set(locale, formatter);
  }
  return formatter.format(value);
}
