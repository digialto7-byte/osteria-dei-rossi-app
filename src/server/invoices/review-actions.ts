import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/errors";
import { loadInvoiceReview } from "@/server/invoices/review";
import { mapReviewError, procedureError } from "@/server/invoices/review-errors";
import {
  checkLinePatchRules,
  type LinePatchBody,
  type HeaderPatchBody,
  type SplitBody,
  type SupplierBody,
} from "@/server/invoices/review-schemas";
import { getInvoice, type InvoiceItem } from "@/server/invoices/invoices";
import { checkedVatNumber } from "@/server/master/suppliers";
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

// Money and quantities are compared as whole ten-thousandths, never as floats.
const units = (value: number) => Math.round(value * 1e4);

/** Σ children − parent for the quantity and the amount, in exact arithmetic. */
export function splitDiff(
  parent: { qty: number; lineAmount: number },
  children: readonly { qty: number; lineAmount: number }[],
): { qtyDiff: number; amountDiff: number } {
  const sum = (pick: (child: { qty: number; lineAmount: number }) => number) =>
    children.reduce((total, child) => total + units(pick(child)), 0);
  return {
    qtyDiff: (sum((child) => child.qty) - units(parent.qty)) / 1e4 || 0,
    amountDiff: (sum((child) => child.lineAmount) - units(parent.lineAmount)) / 1e4 || 0,
  };
}

/** Divides a line into parts. A wrong sum is answered here with the differences; the database repeats the rule. */
export async function splitLine(
  supabase: SupabaseClient,
  invoiceId: string,
  lineId: string,
  body: SplitBody,
): Promise<InvoiceReview> {
  const { data, error } = await supabase
    .from("invoice_line")
    .select("qty, line_amount")
    .eq("id", lineId)
    .eq("invoice_id", invoiceId)
    .maybeSingle();
  if (error) throw mapReviewError(error);
  if (!data) throw new ApiError(404, "not_found", "Risorsa non trovata.");
  const row = data as { qty: number | string; line_amount: number | string };

  const diff = splitDiff(
    { qty: Number(row.qty), lineAmount: Number(row.line_amount) },
    body.children,
  );
  if (diff.qtyDiff !== 0 || diff.amountDiff !== 0) {
    const mismatch = procedureError("split_sum_mismatch");
    throw new ApiError(mismatch.status, mismatch.code, mismatch.message, [diff]);
  }
  await callReviewProcedure(supabase, "review_split_line", {
    p_invoice: invoiceId,
    p_line: lineId,
    p_children: body.children.map((child) => ({ qty: child.qty, line_amount: child.lineAmount })),
  });
  return loadInvoiceReview(supabase, invoiceId);
}

export async function unsplitLine(
  supabase: SupabaseClient,
  invoiceId: string,
  lineId: string,
): Promise<InvoiceReview> {
  await callReviewProcedure(supabase, "review_unsplit_line", {
    p_invoice: invoiceId,
    p_line: lineId,
  });
  return loadInvoiceReview(supabase, invoiceId);
}

/** Links an existing supplier or creates one from the extracted data (M1 supplier rules). */
export async function setSupplier(
  supabase: SupabaseClient,
  invoiceId: string,
  body: SupplierBody,
): Promise<InvoiceReview> {
  const create = body.create
    ? definedOnly({
        name: body.create.name,
        vat_number: checkedVatNumber(body.create.vatNumber),
        payment_terms_days: body.create.paymentTermsDays,
      })
    : null;
  await callReviewProcedure(supabase, "review_set_supplier", {
    p_invoice: invoiceId,
    p_supplier: body.supplierId ?? null,
    p_new: create,
  });
  return loadInvoiceReview(supabase, invoiceId);
}

/** Header corrections; the database re-runs the totals gate and the duplicate check. */
export async function updateHeader(
  supabase: SupabaseClient,
  invoiceId: string,
  body: HeaderPatchBody,
): Promise<InvoiceReview> {
  await callReviewProcedure(supabase, "review_update_header", {
    p_invoice: invoiceId,
    p_patch: definedOnly({
      number_raw: body.numberRaw,
      invoice_date: body.invoiceDate,
      due_date: body.dueDate,
      net_total: body.netTotal,
      vat_total: body.vatTotal,
      gross_total: body.grossTotal,
    }),
  });
  return loadInvoiceReview(supabase, invoiceId);
}

/** "Non è un doppione". */
export async function clearDuplicate(
  supabase: SupabaseClient,
  invoiceId: string,
): Promise<InvoiceReview> {
  await callReviewProcedure(supabase, "review_clear_duplicate", { p_invoice: invoiceId });
  return loadInvoiceReview(supabase, invoiceId);
}

/** "Riprova lettura": the worker picks the invoice up again (and makes the paid call). */
export async function retryExtraction(
  supabase: SupabaseClient,
  invoiceId: string,
): Promise<InvoiceItem> {
  await callReviewProcedure(supabase, "retry_extraction", { p_invoice: invoiceId });
  return getInvoice(supabase, invoiceId);
}
