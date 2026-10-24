import type { BadgeTone } from "@/components/ui";
import { isMessageKey, t } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { formatEuro } from "@/lib/money/format";

// Presentation helpers for the menu screens. Pure: they only word what the API already decided. The price string
// comes from here, never from arithmetic in a component. The role list mirrors the routes.

/** Only owner and admin edit the menu. Mirrors the API's role list. */
export const canEditMenu = (role: string): boolean => role === "owner" || role === "admin";

/** "Secondi"; an unknown course gets a neutral word, never the raw code. */
export function courseWord(course: string, locale: Locale = DEFAULT_LOCALE): string {
  const key = `menu.course.${course}`;
  return t(isMessageKey(key) ? key : "menu.course.unknown", {}, locale);
}

export interface MenuBadge {
  id: "inactive" | "unmapped" | "recipe_inactive" | "unavailable";
  tone: BadgeTone;
  label: string;
}

/**
 * The flags of a menu item card, in a fixed order. "Senza ricetta" is the unmapped state (AT5); an unmapped item
 * has no recipe to be deactivated, so it never also shows "Ricetta disattivata".
 */
export function badgesFor(
  item: {
    unmapped: boolean;
    recipeActive: boolean | null;
    available: boolean;
    active: boolean;
  },
  locale: Locale = DEFAULT_LOCALE,
): MenuBadge[] {
  const badges: MenuBadge[] = [];
  if (!item.active) {
    badges.push({ id: "inactive", tone: "neutral", label: t("menu.badge.inactive", {}, locale) });
  }
  if (item.unmapped) {
    badges.push({ id: "unmapped", tone: "warning", label: t("menu.badge.unmapped", {}, locale) });
  } else if (item.recipeActive === false) {
    badges.push({
      id: "recipe_inactive",
      tone: "warning",
      label: t("menu.badge.recipe_inactive", {}, locale),
    });
  }
  if (!item.available) {
    badges.push({
      id: "unavailable",
      tone: "neutral",
      label: t("menu.badge.unavailable", {}, locale),
    });
  }
  return badges;
}

/** "14,00 € · IVA 10 %" from the server's price and VAT rate. */
export function priceLine(price: number, vatRate: number, locale: Locale = DEFAULT_LOCALE): string {
  const rate = locale === "it" ? String(vatRate).replace(".", ",") : String(vatRate);
  return t("menu.priceLine", { price: formatEuro(price, locale), rate }, locale);
}
