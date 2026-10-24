import { t } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";

/**
 * The seven reasons a batch discard can have (M15 plan §3.1.1): the PRD list of the stock catalogue minus
 * `count_correction`, because a count is an adjustment, not a discard. The literal list, in the same order, is
 * asserted by pgTAP 130 for app.batch_waste_reason_codes(); keep the two in agreement.
 */
export const BATCH_WASTE_REASONS = [
  "spoilage",
  "expired",
  "over_production",
  "plating_error",
  "staff_meal",
  "comp",
  "breakage",
] as const;

export type BatchWasteReason = (typeof BATCH_WASTE_REASONS)[number];

/** The word of a reason, from the stock catalogue (one list of words for raw and batch waste). */
export function batchReasonLabel(code: BatchWasteReason, locale: Locale = DEFAULT_LOCALE): string {
  return t(`stock.reason.${code}`, {}, locale);
}
