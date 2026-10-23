import type { BadgeTone } from "@/components/ui";
import { t } from "@/lib/i18n";
import { DEFAULT_LOCALE, INTL_LOCALE, type Locale } from "@/lib/i18n/locale";
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

/** An instant in venue time as the lists write it, with the comma: "23/10/2026, 12:12". */
export function formatLabelInstantComma(instant: string, locale: Locale = DEFAULT_LOCALE): string {
  return formatDateTime(new Date(instant), locale);
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

/**
 * What the chef typed in a quantity field, as a number: digits with an optional comma or point and at most 4
 * decimals ("5,3", "0.2067", "0"). Zero is allowed here ("not used"). Null for anything else. Only the shape is
 * read; the limits are the API's and the database's.
 */
export function parseUsedQty(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+([.,]\d{1,4})?$/.test(trimmed)) return null;
  return Number(trimmed.replace(",", "."));
}

/** A whole number typed in a field (portions, hours): digits only. Null for anything else. */
export function parseWholeNumber(text: string): number | null {
  const trimmed = text.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

const proposedFormatters = new Map<Locale, Intl.NumberFormat>();

/** A proposed quantity with the 4 decimals the proposal has, e.g. "5,1667 kg" (no-break space before the unit). */
export function formatProposedQty(
  qty: number,
  unit: QuantityUnit,
  locale: Locale = DEFAULT_LOCALE,
): string {
  let formatter = proposedFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(INTL_LOCALE[locale], {
      maximumFractionDigits: 4,
      useGrouping: "always",
    });
    proposedFormatters.set(locale, formatter);
  }
  return `${formatter.format(qty)}\u00a0${unit}`;
}

/** A number as the chef would type it into a field (Italian decimal comma): 5.1667 becomes "5,1667". */
export function qtyToInput(value: number): string {
  return String(value).replace(".", ",");
}
