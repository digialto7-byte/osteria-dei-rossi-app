import type { BadgeTone } from "@/components/ui";
import { t } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { formatDateTime } from "@/lib/time/format";
import { formatQty } from "@/lib/units/format";
import type { QuantityUnit } from "@/lib/units/convert";
import type { BatchLabel, UseByState } from "@/server/batches/types";

// Presentation helpers for the production screens. Pure: they only word what the API already decided (the use-by
// state comes from app.use_by_state, the role lists mirror the routes, the instants are shown in Europe/Rome).
// Nothing here compares dates or computes a quantity.

/** Production is for owner, admin and chef; the waiter has no access. Mirrors the API's role list. */
export const canProduce = (role: string): boolean =>
  role === "owner" || role === "admin" || role === "chef";

/** The frozen batch cost is for owner and admin only (founder Q16 = project V6). Mirrors the API's role list. */
export const canReadBatchCosts = (role: string): boolean => role === "owner" || role === "admin";

/** The badge of a use-by state: expired and due soon say it in words; an ok batch shows none. */
export function useByBadge(
  state: UseByState,
  locale: Locale = DEFAULT_LOCALE,
): { tone: BadgeTone; label: string } | null {
  if (state === "expired") return { tone: "danger", label: t("batch.useBy.expired", {}, locale) };
  if (state === "due_soon") {
    return { tone: "warning", label: t("batch.useBy.due_soon", {}, locale) };
  }
  return null;
}

/** An instant in venue time without the comma of the date-time formatter: "26/03/2027 20:00". */
export function formatLabelInstant(instant: string, locale: Locale = DEFAULT_LOCALE): string {
  return formatDateTime(new Date(instant), locale).replace(", ", " ");
}

/** The six lines of the label text, to copy by hand onto the label (PRD 2.2). */
export function labelLines(
  label: Pick<
    BatchLabel,
    "recipeName" | "producedAt" | "useBy" | "portions" | "lotCode" | "operatorInitials"
  >,
  locale: Locale = DEFAULT_LOCALE,
): string[] {
  return [
    label.recipeName,
    t("batch.label.produced", { date: formatLabelInstant(label.producedAt, locale) }, locale),
    t("batch.label.useBy", { date: formatLabelInstant(label.useBy, locale) }, locale),
    t("batch.label.portions", { count: label.portions }, locale),
    t("batch.label.lot", { code: label.lotCode }, locale),
    t("batch.label.operator", { initials: label.operatorInitials }, locale),
  ];
}

/** "Calcolate: 31 (0,2 kg a porzione, arrotondate per difetto)": how the computed number was made. */
export function portionsHint(
  computed: number,
  portionSize: number,
  unit: QuantityUnit,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return t(
    "batch.portionsHint",
    { count: computed, size: formatQty(portionSize, unit, locale) },
    locale,
  );
}
