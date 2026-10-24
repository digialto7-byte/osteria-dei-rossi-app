import { Badge, LedgerRow } from "@/components/ui";
import { auditActionWord } from "@/lib/counts/count-view";
import { t } from "@/lib/i18n";
import { formatSignedQty } from "@/lib/stock/stock-view";
import { formatDateTime } from "@/lib/time/format";
import { formatQty } from "@/lib/units/format";
import { reasonLabel, type StockReasonCode } from "@/server/stock/reasons";
import type { AuditEntry } from "@/server/audit/types";

function subject(entry: AuditEntry): string {
  if (entry.kind === "stock") {
    const unit = entry.unit ?? "kg";
    const qty =
      entry.qty === undefined
        ? ""
        : entry.action === "transfer"
          ? formatQty(entry.qty, unit)
          : formatSignedQty(entry.qty, unit);
    const places = (entry.locationNames ?? []).join(entry.action === "transfer" ? " → " : ", ");
    const reason = entry.reasonCode ? reasonLabel(entry.reasonCode as StockReasonCode) : "";
    return [[entry.ingredientName, qty].filter(Boolean).join(" "), places, reason]
      .filter(Boolean)
      .join(" · ");
  }
  const label = entry.entityLabel ?? "";
  if (entry.entityType === "invoice" && label) return t("audit.subject.invoice", { label });
  if (entry.entityType === "payable" && label) return t("audit.subject.payable", { label });
  return label;
}

/**
 * One entry of the activity log: a neutral badge with the action word, what it was about, and a .num line with the
 * Europe/Rome time and who did it. The words and the subject come from the server's entry; no cost and no free text.
 */
export function AuditRow({ entry }: { entry: AuditEntry }) {
  const text = subject(entry);
  return (
    <LedgerRow className="flex flex-col gap-1.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">{auditActionWord(entry.action)}</Badge>
        {text && <span className="min-w-0 [overflow-wrap:anywhere]">{text}</span>}
      </div>
      <p className="num text-sm text-ink-muted">
        {formatDateTime(new Date(entry.at))} · {entry.byName ?? "—"}
      </p>
    </LedgerRow>
  );
}
