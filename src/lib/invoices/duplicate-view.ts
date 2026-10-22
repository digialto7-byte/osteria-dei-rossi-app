import { t, type MessageKey } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { formatCalendarDate } from "@/lib/time/format";
import type { DuplicatePartner, InvoiceReview } from "@/server/invoices/review-types";

/** The look-alike as the owner reads it: "FT 40 del 01/09/2026" (the date in the venue's format). */
export function duplicatePartnerLabel(
  partner: Pick<DuplicatePartner, "number" | "date">,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return t(
    "review.duplicatePartnerLabel",
    { number: partner.number, date: formatCalendarDate(partner.date, locale) },
    locale,
  );
}

/** What the duplicate area of the review screen offers. */
export interface DuplicateGuidance {
  /**
   * "Non è un doppione di FT 40 del 01/09/2026": the button text, and the partner id the request sends,
   * so the database declares the pair the owner is looking at (and no other).
   */
  action: { partnerId: string; label: string } | null;
  /** A sentence for a duplicate whose original has left, so there is nothing to declare. */
  hint: MessageKey | null;
}

/**
 * The action is offered for an invoice the database holds against a look-alike, and only against that
 * one: `partner` comes from the duplicate blocker of the approval preview (the look-alike the approval
 * gate and `review_clear_duplicate` compute), never from the stored pointers. A duplicate with no partner
 * has lost its original (rejected since): it cannot be declared against anything, so the hint says to
 * reject it. Nothing else is offered.
 */
export function duplicateGuidance(
  status: InvoiceReview["invoice"]["status"],
  partner: DuplicatePartner | null,
  locale: Locale = DEFAULT_LOCALE,
): DuplicateGuidance {
  if (status !== "review" && status !== "duplicate") return { action: null, hint: null };
  if (!partner) {
    return { action: null, hint: status === "duplicate" ? "review.duplicateOriginalGone" : null };
  }
  return {
    action: {
      partnerId: partner.id,
      label: t(
        "review.notDuplicateOf",
        { partner: duplicatePartnerLabel(partner, locale) },
        locale,
      ),
    },
    hint: null,
  };
}
