import { t } from "@/lib/i18n";
import type { InvoiceItem, InvoiceStatus } from "@/server/invoices/invoices";

// Presentational helpers for the invoice screens. Pure; they only choose words and moments, the data is the API's.

/**
 * What an invoice is called on screen: "Fornitore Demo Srl · 123/A" once it has been read, the supplier alone when the
 * number is missing, else the name of the uploaded file (a photo is called IMG_2041.jpg until then). A number without
 * a supplier is not a name.
 */
export function invoiceTitle(
  invoice: Pick<InvoiceItem, "supplierName" | "number" | "originalFilename">,
): string {
  const supplier = invoice.supplierName?.trim() ?? "";
  const number = invoice.number?.trim() ?? "";
  if (supplier) return number ? `${supplier} · ${number}` : supplier;
  return invoice.originalFilename?.trim() || t("invoices.untitled");
}

// The statuses whose lines the owner can open: `review` to correct, `duplicate` to look at.
const REVIEWABLE: readonly InvoiceStatus[] = ["review", "duplicate"];

/** True when the invoice has lines to open: the review page is then the one forward step. */
export const isReviewable = (status: InvoiceStatus): boolean => REVIEWABLE.includes(status);

/** Where a row of the invoice list leads (QW10): straight to the review for `review` and `duplicate`, else the invoice page. */
export function invoiceHref(invoice: Pick<InvoiceItem, "id" | "status">): string {
  return isReviewable(invoice.status)
    ? `/fatture/${invoice.id}/revisione`
    : `/fatture/${invoice.id}`;
}

const IN_FLIGHT: readonly InvoiceStatus[] = ["received", "extracting"];

/** True while the extraction has not finished: the screens read again until it has. */
export const isInFlight = (status: InvoiceStatus): boolean => IN_FLIGHT.includes(status);
