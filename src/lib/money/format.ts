import { DEFAULT_LOCALE, INTL_LOCALE, type Locale } from "@/lib/i18n/locale";

const formatters = new Map<Locale, Intl.NumberFormat>();

function euroFormatter(locale: Locale): Intl.NumberFormat {
  let formatter = formatters.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(INTL_LOCALE[locale], {
      style: "currency",
      currency: "EUR",
      // it-IT skips grouping below 10.000 by default; the venue writes 1.234,50 €.
      useGrouping: "always",
      roundingMode: "halfExpand",
    });
    formatters.set(locale, formatter);
  }
  return formatter;
}

/** Formats an amount in euro for display, e.g. 1234.5 → "1.234,50 €" (it). */
export function formatEuro(amount: number, locale: Locale = DEFAULT_LOCALE): string {
  if (!Number.isFinite(amount)) {
    throw new RangeError(`formatEuro: amount must be a finite number, got ${amount}`);
  }
  return euroFormatter(locale).format(amount);
}
