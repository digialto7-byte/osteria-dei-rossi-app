import type { MessageKey } from "@/lib/i18n";
import type { InvoiceReview } from "@/server/invoices/review-types";

/** What an invoice write answers: the fresh review, or null when the server could not reload it. */
export interface ActionResponse {
  review: InvoiceReview | null;
  /** Set by approve and reject: the decision that committed. */
  status?: "approved" | "rejected";
  reload?: boolean;
}

export type Decision = "approved" | "rejected";

export interface ActionOutcome {
  /** The review to show now. */
  review: InvoiceReview | null;
  /** The decision to announce while the details are still the old ones; null otherwise. */
  decided: Decision | null;
  /** Whether the page must fetch the review itself. */
  reload: boolean;
}

/**
 * The screen after a decision, before the server's copy of the review has arrived: the status the
 * server reported, no edit controls and no approval panel (a decided invoice cannot be approved
 * again). The rest is what the owner was looking at.
 */
export function markDecided(review: InvoiceReview, status: Decision): InvoiceReview {
  return {
    ...review,
    invoice: { ...review.invoice, status },
    editable: false,
    approval: null,
    decision: null,
    posting: null,
  };
}

/**
 * What the page does with the answer of a successful write. A fresh review replaces the old one.
 * Without one (the action committed but the reload failed) the page must not keep offering what
 * is done: with a `status` it shows the decided state at once and reloads for the details.
 */
export function applyActionResponse(
  current: InvoiceReview | null,
  data: ActionResponse,
): ActionOutcome {
  if (data.review) return { review: data.review, decided: null, reload: false };
  if (data.status) {
    return {
      review: current ? markDecided(current, data.status) : current,
      decided: data.status,
      reload: true,
    };
  }
  return { review: current, decided: null, reload: true };
}

/** The sentence announcing a decision whose details have not loaded. */
export function decidedNoticeKey(status: Decision): MessageKey {
  return status === "approved" ? "approval.decidedApproved" : "approval.decidedRejected";
}
