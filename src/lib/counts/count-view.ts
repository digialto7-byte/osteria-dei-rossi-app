import type { BadgeTone } from "@/components/ui";
import { isMessageKey, t, type MessageKey } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { formatSignedQty } from "@/lib/stock/stock-view";
import type { QuantityUnit } from "@/lib/units/convert";
import { COUNT_QTY_MAX } from "@/server/counts/constants";
import type { CountStatus, CountType } from "@/server/counts/types";

// Presentation helpers for the count screens. Pure: they only word what the API already decided; nothing here sums
// quantities or compares dates. The role lists mirror the routes.

/** Counting is for owner, admin and chef; the waiter has no access. Mirrors the API's role list. */
export const canCount = (role: string): boolean =>
  role === "owner" || role === "admin" || role === "chef";

/** The variance in EUR is for owner and admin only (Q16 = V6). Mirrors the API's role list. */
export const canReadCountCosts = (role: string): boolean => role === "owner" || role === "admin";

/** The activity log is for owner and admin (Q39). Mirrors the API's role list. */
export const canReadAudit = (role: string): boolean => role === "owner" || role === "admin";

export function countTypeWord(type: CountType, locale: Locale = DEFAULT_LOCALE): string {
  return t(`count.type.${type}`, {}, locale);
}

const STATUS_TONE: Record<CountStatus, BadgeTone> = {
  open: "info",
  closed: "neutral",
  cancelled: "neutral",
};

/** The badge of a session: its tone and word. */
export function countStatusView(
  status: CountStatus,
  locale: Locale = DEFAULT_LOCALE,
): { tone: BadgeTone; label: string } {
  return { tone: STATUS_TONE[status], label: t(`count.status.${status}`, {}, locale) };
}

/** Every action the log can show: the audit_event list of the database and the five stock actions. */
export const AUDIT_ACTIONS = [
  "invoice.approved",
  "invoice.rejected",
  "invoice.duplicate_cleared",
  "ingredient.allergens_confirmed",
  "ingredient.critical_changed",
  "recipe.deactivated",
  "recipe.reactivated",
  "tenant.settings_changed",
  "payable.status_changed",
  "payable.payment_reversed",
  "count_session.closed",
  "count_session.cancelled",
  "waste",
  "consumption",
  "transfer",
  "count",
  "reversal",
] as const;

/** "Spreco", "Conteggio chiuso", ...; an action this build does not know shows its code. */
export function auditActionWord(action: string, locale: Locale = DEFAULT_LOCALE): string {
  const key = `audit.action.${action}`;
  return isMessageKey(key) ? t(key as MessageKey, {}, locale) : action;
}

/** "Differenza −0,5 kg" (real minus sign) or "Nessuna differenza". The sign is the server's number, not a comparison. */
export function differenceText(
  diff: number,
  unit: QuantityUnit,
  locale: Locale = DEFAULT_LOCALE,
): string {
  if (diff === 0) return t("count.difference.none", {}, locale);
  return t("count.difference", { qty: formatSignedQty(diff, unit, locale) }, locale);
}

export type CountInput = { kind: "clear" } | { kind: "qty"; value: number } | { kind: "invalid" };

/**
 * What the chef typed in a count field: empty clears the line, digits with an optional comma or dot and at most 4
 * decimals are a quantity (0 included: "none left"), anything else is invalid. Only the shape and the ceiling are read
 * here; the limits in the base unit are the API's and the database's.
 */
export function parseCountInput(text: string): CountInput {
  const trimmed = text.trim();
  if (trimmed === "") return { kind: "clear" };
  if (!/^\d+([.,]\d{1,4})?$/.test(trimmed)) return { kind: "invalid" };
  const value = Number(trimmed.replace(",", "."));
  return value > COUNT_QTY_MAX ? { kind: "invalid" } : { kind: "qty", value };
}
