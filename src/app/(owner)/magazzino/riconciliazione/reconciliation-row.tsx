import { Badge, LedgerRow, type BadgeTone } from "@/components/ui";
import { t } from "@/lib/i18n";
import { formatSignedQty, formatStockQty } from "@/lib/stock/stock-view";
import { formatCalendarDate } from "@/lib/time/format";
import { venueDate } from "@/lib/time/venue-date";
import { formatQty } from "@/lib/units/format";
import type { ReconciliationItem } from "@/server/counts/types";

function badge(item: ReconciliationItem): { tone: BadgeTone; label: string } {
  // A report that does not balance is a bug: it wins over everything else.
  if (!item.balanced) return { tone: "danger", label: t("reconciliation.badge.bad") };
  if (item.matchesCount === null) return { tone: "neutral", label: t("reconciliation.badge.none") };
  if (item.matchesCount) return { tone: "success", label: t("reconciliation.badge.ok") };
  return {
    tone: "warning",
    label: t("reconciliation.badge.after", {
      qty: formatSignedQty(item.afterCountQty ?? 0, item.baseUnit).replace("+", ""),
    }),
  };
}

/**
 * One ingredient of the reconciliation: opening, receipts, consumption, waste, transfers, adjustments and closing in
 * .num lines, the latest count of the period, and a badge with a word that says whether it adds up and matches the
 * count. Every figure is the server's (the identity is computed in SQL); nothing here adds or compares.
 */
export function ReconciliationRow({ item }: { item: ReconciliationItem }) {
  const unit = item.baseUnit;
  const status = badge(item);
  return (
    <LedgerRow className="flex flex-col gap-1.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 font-bold [overflow-wrap:anywhere]">{item.name}</span>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <p className="num text-sm [overflow-wrap:anywhere]">
        {t("reconciliation.line1", {
          opening: formatStockQty(item.openingQty, unit),
          receipts: formatSignedQty(item.receiptsQty, unit),
          consumption: formatSignedQty(-item.consumptionQty, unit),
          waste: formatSignedQty(-item.wasteQty, unit),
        })}
      </p>
      <p className="num text-sm [overflow-wrap:anywhere]">
        {t("reconciliation.line2", {
          in: formatQty(item.transfersInQty, unit),
          out: formatQty(item.transfersOutQty, unit),
          adjustments: formatSignedQty(item.countAdjustmentsQty, unit),
          closing: formatStockQty(item.closingQty, unit),
        })}
      </p>
      {item.otherQty !== 0 && (
        <p className="num text-sm">
          {t("reconciliation.other", { qty: formatSignedQty(item.otherQty, unit) })}
        </p>
      )}
      {item.countedQty !== null && item.countedAt !== null && (
        <p className="num text-sm text-ink-muted">
          {t("reconciliation.counted", {
            qty: formatStockQty(item.countedQty, unit),
            date: formatCalendarDate(venueDate(new Date(item.countedAt))),
          })}
        </p>
      )}
    </LedgerRow>
  );
}
