export const LOCALES = ["it", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "it";

// English uses en-GB so dates stay day-first, as the venue reads them.
export const INTL_LOCALE: Record<Locale, string> = { it: "it-IT", en: "en-GB" };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}
