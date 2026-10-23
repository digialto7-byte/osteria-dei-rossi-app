import { isMessageKey, t, type MessageKey } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { formatPercent } from "@/lib/format/percent";
import { formatCalendarDate } from "@/lib/time/format";
import { venueDate } from "@/lib/time/venue-date";
import { formatNumber } from "@/lib/units/format";
import type { Allergen } from "@/server/master/ingredients";
import type { AllergenSummary, RecipeType } from "@/server/recipes/types";

// Presentation helpers for the recipe screens. Pure: they only word what the API already decided
// (allergen state, portion size, warnings). Nothing here computes a cost or a margin.

export const TYPE_FILTERS = ["all", "batch", "plate", "sub"] as const;
export type TypeFilter = (typeof TYPE_FILTERS)[number];

export const typeLabel = (type: RecipeType, locale: Locale = DEFAULT_LOCALE) =>
  t(`recipes.type.${type}`, {}, locale);

/** "23/10/2026": the Europe/Rome calendar date of the instant a version was saved. */
export const recipeDate = (validFrom: string, locale: Locale = DEFAULT_LOCALE) =>
  formatCalendarDate(venueDate(new Date(validFrom)), locale);

/** "v3 · dal 23/10/2026": the version and the date it was saved. */
export const recipeMeta = (version: number, validFrom: string, locale: Locale = DEFAULT_LOCALE) =>
  t("recipes.meta", { version, date: recipeDate(validFrom, locale) }, locale);

/** "0,2 kg" with a non-breaking space; `porz` is portions. */
export const lineQuantity = (qty: number, unit: string, locale: Locale = DEFAULT_LOCALE) =>
  `${formatNumber(qty, locale)} ${unit}`;

export const yieldText = (factor: number, locale: Locale = DEFAULT_LOCALE) =>
  t("recipes.line.yield", { value: formatNumber(factor, locale) }, locale);

export const hoursText = (count: number, locale: Locale = DEFAULT_LOCALE) =>
  t("recipes.hours", { count }, locale);

export const minutesText = (count: number, locale: Locale = DEFAULT_LOCALE) =>
  t("recipes.minutes", { count }, locale);

/** A percentage stored as 70 (not 0.7), as the venue reads it: "70%". */
export const percentText = (value: number, locale: Locale = DEFAULT_LOCALE) =>
  formatPercent(value / 100, locale);

export const allergenLabel = (allergen: Allergen, locale: Locale = DEFAULT_LOCALE) =>
  t(`allergen.${allergen}`, {}, locale);

/** The allergens as words; an empty confirmed list is said out loud, never left blank. */
export function allergenWords(summary: AllergenSummary, locale: Locale = DEFAULT_LOCALE): string {
  return summary.list.length === 0
    ? t("recipes.allergens.none", {}, locale)
    : summary.list.map((a) => allergenLabel(a, locale)).join(", ");
}

/** "Da confermare: Farina di mais (demo)", or null when nothing waits for a confirmation. */
export function unconfirmedLine(summary: AllergenSummary, locale: Locale = DEFAULT_LOCALE) {
  if (summary.unconfirmedIngredients.length === 0) return null;
  const names = summary.unconfirmedIngredients.map((ingredient) => ingredient.name).join(", ");
  return t("recipes.allergens.unconfirmed", { names }, locale);
}

export const lineWarningText = (line: number, code: "yield_above_one", locale = DEFAULT_LOCALE) =>
  t(`recipes.warning.${code}`, { line }, locale);

/** Roles that read recipes (waiters do not, in M7). */
export const canReadRecipes = (role: string) =>
  role === "owner" || role === "admin" || role === "chef";

/** Roles that set the sale price and target GP% (the chef reads them but never sets them). */
export const canEditRecipePrice = (role: string) => role === "owner" || role === "admin";

type Detail = Record<string, string | number>;

/**
 * The Italian text for an error code from the recipe API, or null when the code is not known (the
 * screen then shows the server's own text). Top-level errors first, then the field codes.
 */
export function recipeErrorText(
  code: string,
  details?: Detail[],
  locale: Locale = DEFAULT_LOCALE,
): string | null {
  if (code === "version_conflict") {
    const current = details?.[0]?.currentVersion;
    return current === undefined
      ? t("recipeError.version_conflict_generic", {}, locale)
      : t("recipeError.version_conflict", { n: current }, locale);
  }
  for (const key of [`recipeError.${code}`, `recipeCode.${code}`]) {
    if (isMessageKey(key)) return t(key as MessageKey, {}, locale);
  }
  return null;
}

/** One field problem as text: the field code's sentence, or the code itself when it is new. */
export function fieldErrorText(detail: Detail, locale: Locale = DEFAULT_LOCALE): string {
  const code = String(detail.code ?? "");
  const key = `recipeCode.${code}`;
  return isMessageKey(key) ? t(key as MessageKey, {}, locale) : code;
}
