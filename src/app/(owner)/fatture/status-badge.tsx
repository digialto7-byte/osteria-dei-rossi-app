import { t } from "@/lib/i18n";
import type { InvoiceStatus } from "@/server/invoices/invoices";

type Tone = "neutral" | "info" | "warning" | "success" | "danger";

const STATUS_TONE: Record<InvoiceStatus, Tone> = {
  received: "neutral",
  extracting: "info",
  extraction_failed: "danger",
  review: "warning",
  approved: "success",
  rejected: "danger",
  duplicate: "warning",
};

// Text and background are token pairs tested for AA in both themes (tests/lib/design).
const TONE: Record<Tone, { badge: string; dot: string }> = {
  neutral: { badge: "bg-sunk text-ink-muted", dot: "bg-ink-muted" },
  info: { badge: "bg-info-bg text-info", dot: "bg-info" },
  warning: { badge: "bg-warning-bg text-warning", dot: "bg-warning" },
  success: { badge: "bg-success-bg text-success", dot: "bg-success" },
  danger: { badge: "bg-danger-bg text-danger", dot: "bg-danger" },
};

/** The invoice status as a label. Presentational only: the status itself comes from the API. */
export function StatusBadge({ status }: { status: InvoiceStatus }) {
  const tone = TONE[STATUS_TONE[status]];
  return (
    <span
      data-testid="invoice-status"
      className={`inline-flex items-center gap-1.5 self-start rounded-full px-2.5 py-0.5 text-sm font-bold ${tone.badge}`}
    >
      <span aria-hidden="true" className={`size-1.5 rounded-full ${tone.dot}`} />
      {t(`invoiceStatus.${status}`)}
    </span>
  );
}
