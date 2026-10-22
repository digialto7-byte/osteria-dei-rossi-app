import { t } from "@/lib/i18n";
import type { InvoiceStatus } from "@/server/invoices/invoices";

const TONE: Record<InvoiceStatus, string> = {
  received: "border-stone-400 bg-stone-100 text-stone-900",
  extracting: "border-sky-300 bg-sky-50 text-sky-900",
  extraction_failed: "border-red-300 bg-red-50 text-red-900",
  review: "border-amber-300 bg-amber-50 text-amber-900",
  approved: "border-green-300 bg-green-50 text-green-900",
  rejected: "border-red-300 bg-red-50 text-red-900",
  duplicate: "border-orange-300 bg-orange-50 text-orange-900",
};

/** The invoice status as a label. Presentational only: the status itself comes from the API. */
export function StatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span
      data-testid="invoice-status"
      className={`inline-block rounded border px-2 py-0.5 text-sm font-medium ${TONE[status]}`}
    >
      {t(`invoiceStatus.${status}`)}
    </span>
  );
}
