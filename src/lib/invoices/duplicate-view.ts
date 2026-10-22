import type { MessageKey } from "@/lib/i18n";
import type { ApprovalInfo, InvoiceReview } from "@/server/invoices/review-types";

/** What the duplicate area of the review screen offers. */
export interface DuplicateGuidance {
  /** Show "Non è un doppione". */
  canClear: boolean;
  /** A sentence for an invoice that is a duplicate but has no action to take on screen. */
  hint: MessageKey | null;
}

const DUPLICATE_CODES = new Set(["duplicate_invoice", "duplicate_warning"]);

/**
 * Whether to offer "Non è un doppione". The database decides which look-alikes block an invoice and
 * the action declares the first of them, so the action is offered whenever the approval preview has a
 * duplicate blocker, whether or not the invoice stores a pointer to its partner (an invoice cleared in
 * M4, a copy that arrived later, the original of a look-alike pair, a partner other than the stored
 * one). The stored warning is only the fallback while there is no preview. A duplicate that names no
 * original has nothing to clear on screen: the hint says what to do instead.
 */
export function duplicateGuidance(
  invoice: Pick<InvoiceReview["invoice"], "status" | "duplicateOf" | "duplicateWarningOf">,
  approval: ApprovalInfo | null,
): DuplicateGuidance {
  if (invoice.status === "duplicate") {
    return invoice.duplicateOf
      ? { canClear: true, hint: null }
      : { canClear: false, hint: "review.duplicateNoAction" };
  }
  if (invoice.status !== "review") return { canClear: false, hint: null };
  const canClear = approval
    ? approval.blockers.some((b) => DUPLICATE_CODES.has(b.code))
    : invoice.duplicateWarningOf !== null;
  return { canClear, hint: null };
}
