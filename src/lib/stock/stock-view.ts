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

/**
 * "Spreco", "Spostamento", ...; any reversal row is an "Annullamento"; the consumption of a production (operation
 * kind "batch", M14) is a "Produzione".
 */
export function movementTypeWord(
  type: StockMovementType,
  isReversal: boolean,
  locale: Locale = DEFAULT_LOCALE,
  refType?: string,
): string {
  if (isReversal) return t("stock.type.reversal", {}, locale);
  if (type === "consumption" && refType === "batch") return t("stock.type.production", {}, locale);
  return t(`stock.type.${type}`, {}, locale);
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

/** A quantity with the real minus sign (U+2212) when negative and no plus sign: "−1 kg", "12,3 kg". */
export function formatStockQty(
  qty: number,
  unit: QuantityUnit,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return `${qty < 0 ? MINUS : ""}${formatQty(Math.abs(qty), unit, locale)}`;
}

/**
 * What the chef typed in a quantity field, as a number: digits with an optional comma or dot and at most 4
 * decimals ("1,5", "0.25", "2"). Null for anything else (empty, a sign, a thousands separator, letters, zero).
 * Only the shape is read here; the limits are the API's and the database's.
 */
export function parseQtyInput(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+([.,]\d{1,4})?$/.test(trimmed)) return null;
  const value = Number(trimmed.replace(",", "."));
  return value > 0 ? value : null;
}
