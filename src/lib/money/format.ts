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

/**
 * The price of a weighted dish per 100 g (per etto), e.g. 9 → "9,00 € / 100 g" (it). The number is
 * the stored price per 100 g as the API returns it; nothing is multiplied or divided here.
 */
export function formatPricePerEtto(pricePer100g: number, locale: Locale = DEFAULT_LOCALE): string {
  return `${formatEuro(pricePer100g, locale)} / 100 g`;
}
