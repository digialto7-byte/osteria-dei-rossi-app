import { t } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { allergenLabel } from "@/lib/recipes/recipe-view";
import { formatCalendarDate } from "@/lib/time/format";
import { venueDate } from "@/lib/time/venue-date";
import type { Allergen, AllergenStatus } from "@/server/master/ingredients";

// Presentation helpers for the ingredient allergen state. The state itself (unknown, declared,
// confirmed) is decided by the database; null is "not stated" and is never worded as "none".

/** "Non indicati" for an unknown list, "Nessuno" for a declared empty one, else the allergens in words. */
export function allergenCellText(
  allergens: Allergen[] | null,
  locale: Locale = DEFAULT_LOCALE,
): string {
  if (allergens === null) return t("ingredients.allergenState.unknown", {}, locale);
  if (allergens.length === 0) return t("ingredients.allergenState.none", {}, locale);
  return allergens.map((allergen) => allergenLabel(allergen, locale)).join(", ");
}

/** Unknown and declared lists wait for the owner; only a confirmed one is final. */
export const needsConfirmation = (status: AllergenStatus) => status !== "confirmed";

/** "Confermati il 23/10/2026": the Europe/Rome date of the confirmation. */
export function confirmedOnText(confirmedAt: string, locale: Locale = DEFAULT_LOCALE): string {
  const date = formatCalendarDate(venueDate(new Date(confirmedAt)), locale);
  return t("ingredients.allergenState.confirmedOn", { date }, locale);
}

/** Q6 = owner only: DigiAlto support (admin) and the chef never confirm an allergen list. */
export const canConfirmAllergens = (role: string | null) => role === "owner";
