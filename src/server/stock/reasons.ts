import { t } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";

/**
 * The eight waste reason codes (PRD 2.5), in the order of app.stock_reason_codes(). pgTAP 090 asserts the
 * same literal list on the database side; keep the two in agreement.
 */
export const STOCK_REASON_CODES = [
  "spoilage",
  "expired",
  "over_production",
  "plating_error",
  "staff_meal",
  "comp",
  "breakage",
  "count_correction",
] as const;

export type StockReasonCode = (typeof STOCK_REASON_CODES)[number];

export function reasonLabel(code: StockReasonCode, locale: Locale = DEFAULT_LOCALE): string {
  return t(`stock.reason.${code}`, {}, locale);
}
