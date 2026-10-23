import type { BadgeTone } from "@/components/ui";
import { t } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { formatCalendarDate } from "@/lib/time/format";
import { formatQty } from "@/lib/units/format";
import type { QuantityUnit } from "@/lib/units/convert";
import type { ExpiryState, StockMovementType } from "@/server/stock/types";

// Presentation helpers for the stock screens. Pure: they only word what the API already decided (the expiry state
// comes from app.expiry_state, the role lists mirror the routes). Nothing here compares dates or adds quantities.

/** Stock is for owner, admin and chef; the waiter has no access (plan §3.10). Mirrors the API's role list. */
export const canReadStock = (role: string): boolean =>
  role === "owner" || role === "admin" || role === "chef";

/** Waste in EUR is for owner and admin only (Q16 = V6). Mirrors the API's role list. */
export const canReadWasteCosts = (role: string): boolean => role === "owner" || role === "admin";

const EXPIRY_TONE: Record<ExpiryState, BadgeTone> = {
  none: "neutral",
  expired: "danger",
  due_soon: "warning",
  ok: "neutral",
};

/** The badge of a lot: its tone and word. The word always says it; colour is only a reinforcement. */
export function expiryView(
  state: ExpiryState,
  expiry: string | null,
  locale: Locale = DEFAULT_LOCALE,
): { tone: BadgeTone; label: string } {
  const label =
    state === "none" || expiry === null
      ? t("stock.expiry.none", {}, locale)
      : t(`stock.expiry.${state}`, { date: formatCalendarDate(expiry, locale) }, locale);
  return { tone: EXPIRY_TONE[state], label };
}

/** "Spreco", "Spostamento", ...; any reversal row is an "Annullamento". */
export function movementTypeWord(
  type: StockMovementType,
  isReversal: boolean,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return t(isReversal ? "stock.type.reversal" : `stock.type.${type}`, {}, locale);
}

const MINUS = "−";

/** "−1,5 kg" (real minus sign U+2212), "+1,5 kg" for a leg that adds, "0 kg". */
export function formatSignedQty(
  qty: number,
  unit: QuantityUnit,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const shown = formatQty(Math.abs(qty), unit, locale);
  return `${qty < 0 ? MINUS : qty > 0 ? "+" : ""}${shown}`;
}
