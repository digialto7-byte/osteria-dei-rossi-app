import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApproveBody, RejectBody } from "@/server/invoices/approval-schemas";
import { reportError } from "@/lib/observability/report";
import { loadInvoiceReview } from "@/server/invoices/review";
import { callReviewProcedure } from "@/server/invoices/review-actions";
import type { InvoiceReview } from "@/server/invoices/review-types";

/**
 * What the route answers once the action has committed. `review` is the refreshed review, or null
 * when the reload failed after the commit: the action succeeded, so the client gets the new status
 * and `reload: true` and fetches the review itself instead of seeing a 500 for a done action.
 */
export type ApprovalResult = {
  review: InvoiceReview | null;
  status: "approved" | "rejected";
  reload: boolean;
};

/**
 * Reloads the review after a committed action. A failure here must not turn the success into an
 * error (a retry would be refused with a 409 and the owner would think nothing happened): it is
 * reported, and the caller answers with the status it knows.
 */
async function afterCommit(
  supabase: SupabaseClient,
  invoiceId: string,
  status: ApprovalResult["status"],
): Promise<ApprovalResult> {
  try {
    return { review: await loadInvoiceReview(supabase, invoiceId), status, reload: false };
  } catch (error) {
    reportError(error);
    return { review: null, status, reload: true };
  }
}

/**
 * Approves the invoice: one Postgres transaction posts the receipts, lots, prices and payable
 * (`approve_invoice`). The role, tenant, status and every gate are checked there; this only maps
 * its errors and returns the refreshed review (now with `decision` and `posting`) or, if the reload fails, the status.
 */
export async function approveInvoice(
  supabase: SupabaseClient,
  invoiceId: string,
  body: ApproveBody,
): Promise<ApprovalResult> {
  await callReviewProcedure(supabase, "approve_invoice", {
    p_invoice: invoiceId,
    p_location: body.locationId ?? null,
  });
  return afterCommit(supabase, invoiceId, "approved");
}

/** Rejects the invoice, with an optional reason (already trimmed and checked by the schema). */
export async function rejectInvoice(
  supabase: SupabaseClient,
  invoiceId: string,
  body: RejectBody,
): Promise<ApprovalResult> {
  await callReviewProcedure(supabase, "reject_invoice", {
    p_invoice: invoiceId,
    p_reason: body.reason ?? null,
  });
  return afterCommit(supabase, invoiceId, "rejected");
}
