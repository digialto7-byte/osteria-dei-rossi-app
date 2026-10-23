import Link from "next/link";
import { Badge, LedgerRow, linkClass } from "@/components/ui";
import { t } from "@/lib/i18n";
import { amountText, dueLine, invoiceLine, statusView } from "@/lib/payables/payable-view";
import type { PayableItem } from "@/server/payables/types";

/**
 * One payable of a list: the supplier as a link, the amount at the right edge, the invoice and due
 * lines, and the status as a word in a badge (plus "Scaduta" when the server says it is overdue).
 */
export function PayableRow({ item }: { item: PayableItem }) {
  const status = statusView(item.status, item.paidOn);
  return (
    <LedgerRow className="flex flex-col gap-1.5 py-3">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 [overflow-wrap:anywhere]">
          <Link href={`/pagamenti/${item.id}`} className={linkClass}>
            {item.supplierName}
          </Link>
        </span>
        <span className="num shrink-0 font-bold">{amountText(item.amount)}</span>
      </div>
      <p className="num text-sm text-ink-muted">
        {invoiceLine(item.invoiceNumber, item.invoiceDate)}
      </p>
      <p className="num text-sm">{dueLine(item)}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={status.tone}>{status.label}</Badge>
        {item.overdue && <Badge tone="danger">{t("payables.overdue")}</Badge>}
      </div>
    </LedgerRow>
  );
}
