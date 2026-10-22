import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/errors";
import { loadInvoiceReview } from "@/server/invoices/review";
import { mapReviewError } from "@/server/invoices/review-errors";
import { checkLinePatchRules, type LinePatchBody } from "@/server/invoices/review-schemas";
import type { InvoiceReview } from "@/server/invoices/review-types";

/**
 * Calls one review procedure as the signed-in user. The procedures return void and check role,
 * tenant and invoice state themselves; this only maps their errors.
 */
export async function callReviewProcedure(
  supabase: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.rpc(name, args);
  if (error) throw mapReviewError(error);
}

const definedOnly = (values: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));

/** The procedure's patch: snake_case keys, only what the body names. */
export function toLinePatch(body: LinePatchBody): Record<string, unknown> {
  return definedOnly({
    qty: body.qty,
    unit_price: body.unitPrice,
    line_amount: body.lineAmount,
    vat_rate: body.vatRate,
    supplier_code: body.supplierCode,
    unit: body.unit,
    ingredient_id: body.ingredientId,
    pack: body.pack ? definedOnly({ ...body.pack }) : undefined,
    is_stock: body.isStock,
    cost_centre_id: body.costCentreId,
    credit_qty: body.creditQty,
    lot_code: body.lotCode,
    expiry: body.expiry,
    reviewed: body.reviewed,
  });
}

/** A credit is compared with the qty the line has now when the body does not change it. */
async function storedQty(supabase: SupabaseClient, invoiceId: string, lineId: string) {
  const { data, error } = await supabase
    .from("invoice_line")
    .select("qty")
    .eq("id", lineId)
    .eq("invoice_id", invoiceId)
    .maybeSingle();
  if (error) throw mapReviewError(error);
  if (!data) throw new ApiError(404, "not_found", "Risorsa non trovata.");
  return Number((data as { qty: number | string }).qty);
}

/** One line action (map, pack, non-stock, credit, lot, expiry, corrections, "checked"). */
export async function updateLine(
  supabase: SupabaseClient,
  invoiceId: string,
  lineId: string,
  body: LinePatchBody,
): Promise<InvoiceReview> {
  checkLinePatchRules(body);
  if (body.creditQty !== undefined && body.qty === undefined) {
    checkLinePatchRules({
      qty: await storedQty(supabase, invoiceId, lineId),
      creditQty: body.creditQty,
    });
  }
  await callReviewProcedure(supabase, "review_update_line", {
    p_invoice: invoiceId,
    p_line: lineId,
    p_patch: toLinePatch(body),
  });
  return loadInvoiceReview(supabase, invoiceId);
}
