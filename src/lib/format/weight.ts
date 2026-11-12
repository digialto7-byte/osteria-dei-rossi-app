import { DEFAULT_LOCALE, INTL_LOCALE, type Locale } from "@/lib/i18n/locale";

const formatters = new Map<Locale, Intl.NumberFormat>();

function numberFormatter(locale: Locale): Intl.NumberFormat {
  let formatter = formatters.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(INTL_LOCALE[locale], {
      useGrouping: "always",
      maximumFractionDigits: 3,
    });
    formatters.set(locale, formatter);
  }
  return formatter;
}

/**
 * A weight in grams for display: below 1 000 g "250 g", otherwise kilograms with up to three
 * decimals and no trailing zeros ("1,2 kg", "1,25 kg"). Formatting only: no price arithmetic.
 */
export function formatWeight(grams: number, locale: Locale = DEFAULT_LOCALE): string {
  if (!Number.isFinite(grams) || grams < 0) {
    throw new RangeError(`formatWeight: grams must be a finite, non-negative number, got ${grams}`);
  }
  const formatter = numberFormatter(locale);
  if (grams < 1000) return `${formatter.format(grams)} g`;
  // Whole grams divided by 1 000 are exact to three decimals; this is a unit change, not money.
  return `${formatter.format(grams / 1000)} kg`;
}
