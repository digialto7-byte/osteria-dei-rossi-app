import { Badge, type BadgeTone } from "@/components/ui";
import { t } from "@/lib/i18n";
import type { InvoiceStatus } from "@/server/invoices/invoices";

const STATUS_TONE: Record<InvoiceStatus, BadgeTone> = {
  received: "neutral",
  extracting: "info",
  extraction_failed: "danger",
  review: "warning",
  approved: "success",
  rejected: "danger",
  duplicate: "warning",
};

/** The invoice status as a label. Presentational only: the status itself comes from the API. */
export function StatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} data-testid="invoice-status">
      {t(`invoiceStatus.${status}`)}
    </Badge>
  );
}
