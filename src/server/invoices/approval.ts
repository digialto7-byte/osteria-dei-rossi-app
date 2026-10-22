import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApproveBody, RejectBody } from "@/server/invoices/approval-schemas";
import { loadInvoiceReview } from "@/server/invoices/review";
import { callReviewProcedure } from "@/server/invoices/review-actions";
import type { InvoiceReview } from "@/server/invoices/review-types";

/**
 * Approves the invoice: one Postgres transaction posts the receipts, lots, prices and payable
 * (`approve_invoice`). The role, tenant, status and every gate are checked there; this only maps
 * its errors and returns the refreshed review (now with `decision` and `posting`).
 */
export async function approveInvoice(
  supabase: SupabaseClient,
  invoiceId: string,
  body: ApproveBody,
): Promise<InvoiceReview> {
  await callReviewProcedure(supabase, "approve_invoice", {
    p_invoice: invoiceId,
    p_location: body.locationId ?? null,
  });
  return loadInvoiceReview(supabase, invoiceId);
}

/** Rejects the invoice, with an optional reason (already trimmed and checked by the schema). */
export async function rejectInvoice(
  supabase: SupabaseClient,
  invoiceId: string,
  body: RejectBody,
): Promise<InvoiceReview> {
  await callReviewProcedure(supabase, "reject_invoice", {
    p_invoice: invoiceId,
    p_reason: body.reason ?? null,
  });
  return loadInvoiceReview(supabase, invoiceId);
}
