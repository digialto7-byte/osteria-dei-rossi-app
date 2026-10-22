import { t } from "@/lib/i18n";
import { fieldLabel } from "@/lib/invoices/review-view";
import { parseDecimal, toField } from "@/lib/numbers/parse-decimal";
import type { InvoiceReview } from "@/server/invoices/review-types";

type Invoice = InvoiceReview["invoice"];

export interface HeaderForm {
  numberRaw: string;
  invoiceDate: string;
  dueDate: string;
  netTotal: string;
  vatTotal: string;
  grossTotal: string;
}

export function initialHeaderForm(invoice: Invoice): HeaderForm {
  return {
    numberRaw: invoice.number ?? "",
    invoiceDate: invoice.invoiceDate ?? "",
    dueDate: invoice.dueDate ?? "",
    netTotal: toField(invoice.netTotal),
    vatTotal: toField(invoice.vatTotal),
    grossTotal: toField(invoice.grossTotal),
  };
}

const TOTALS = [
  ["netTotal", "net_total"],
  ["vatTotal", "vat_total"],
  ["grossTotal", "gross_total"],
] as const;

export type HeaderPatchResult =
  { ok: true; patch: Record<string, unknown> } | { ok: false; field: string; message: string };

/** The PATCH body for the header: only what changed; an emptied field clears the value. */
export function buildHeaderPatch(invoice: Invoice, form: HeaderForm): HeaderPatchResult {
  const patch: Record<string, unknown> = {};
  const number = form.numberRaw.trim() || null;
  if (number !== invoice.number) patch.numberRaw = number;
  if ((form.invoiceDate || null) !== invoice.invoiceDate)
    patch.invoiceDate = form.invoiceDate || null;
  if ((form.dueDate || null) !== invoice.dueDate) patch.dueDate = form.dueDate || null;
  for (const [key, name] of TOTALS) {
    const read = parseDecimal(form[key]);
    if (!read.ok) {
      return {
        ok: false,
        field: key,
        message: t("review.error.number", { field: fieldLabel(name) }),
      };
    }
    if (read.value !== invoice[key]) patch[key] = read.value;
  }
  return { ok: true, patch };
}
