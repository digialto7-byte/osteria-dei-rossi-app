import { DEFAULT_LOCALE, INTL_LOCALE, type Locale } from "@/lib/i18n/locale";

const formatters = new Map<string, Intl.NumberFormat>();

function numberFormatter(locale: Locale, maxFractionDigits: number): Intl.NumberFormat {
  const key = `${locale}:${maxFractionDigits}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(INTL_LOCALE[locale], {
      useGrouping: "always",
      maximumFractionDigits: maxFractionDigits,
      roundingMode: "halfExpand",
    });
    formatters.set(key, formatter);
  }
  return formatter;
}

/**
 * A weight in grams for display: below 1 000 g "250 g", otherwise kilograms with up to three
 * decimals and no trailing zeros ("1,2 kg", "1,25 kg"); `kgDecimals` lowers the decimals (a report average). Formatting only: no price arithmetic.
 */
export function formatWeight(
  grams: number,
  locale: Locale = DEFAULT_LOCALE,
  options: { kgDecimals?: number } = {},
): string {
  if (!Number.isFinite(grams) || grams < 0) {
    throw new RangeError(`formatWeight: grams must be a finite, non-negative number, got ${grams}`);
  }
  if (grams < 1000) return `${numberFormatter(locale, 0).format(grams)}\u00a0g`;
  // A unit change, not money. Whole grams are exact to three decimals; a report average may ask for two.
  return `${numberFormatter(locale, options.kgDecimals ?? 3).format(grams / 1000)}\u00a0kg`;
}
