import { t } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { formatCount, formatPortions } from "@/lib/batches/batch-view";
import { formatTime } from "@/lib/time/format";
import type { StaffMealRuleItem } from "@/server/staff-meals/types";

// Presentation helpers for the staff-meal screen. Pure: they only word what the API already decided; the business
// date and the "already confirmed today" state come from the server, nothing is computed here.

/** "Ragù (demo) · 2 porzioni" for a recipe rule, "Pane (demo) · 0,5 kg" for an ingredient rule. */
export function ruleLine(
  rule: Pick<StaffMealRuleItem, "kind" | "name" | "unit" | "defaultCount">,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const quantity =
    rule.kind === "recipe"
      ? formatPortions(rule.defaultCount, locale)
      : `${formatCount(rule.defaultCount, locale)} ${rule.unit}`;
  return `${rule.name} · ${quantity}`;
}

/** "Confermato alle 12:10 · CD": when (venue time) and who confirmed today's meal. */
export function confirmedLine(
  today: { at: string; byInitials: string },
  locale: Locale = DEFAULT_LOCALE,
): string {
  return t(
    "staffMeal.confirmedAt",
    { time: formatTime(new Date(today.at), locale), initials: today.byInitials },
    locale,
  );
}

export type RuleField = "target" | "count" | "unit" | "location";

/** The form field a refused rule (a 422 code) concerns, so the form can mark it; null for any other code. */
export function ruleErrorField(code: string): RuleField | null {
  switch (code) {
    case "staff_meal_target_invalid":
      return "target";
    case "count_invalid":
      return "count";
    case "unit_mismatch":
      return "unit";
    case "location_not_found":
    case "location_required":
    case "no_location":
      return "location";
    default:
      return null;
  }
}
