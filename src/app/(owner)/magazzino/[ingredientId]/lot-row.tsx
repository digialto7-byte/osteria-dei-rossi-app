import { Badge, LedgerRow } from "@/components/ui";
import { t } from "@/lib/i18n";
import { formatCalendarDate } from "@/lib/time/format";
import { expiryView, formatStockQty } from "@/lib/stock/stock-view";
import type { BaseUnit, LotItem } from "@/server/stock/types";

/**
 * One lot bucket: the code, an expiry badge from the server's state (the word always says it), and a detail line.
 * The unlotted bucket (a shortfall booked without a lot) is the row "Senza lotto". No date is compared here and no
 * expiry is derived from the receipt date. Quantities only.
 */
export function LotRow({ lot, unit }: { lot: LotItem; unit: BaseUnit }) {
  const isLot = lot.rawLotId !== null;
  const expiry = isLot && lot.expiryState ? expiryView(lot.expiryState, lot.expiry) : null;
  const parts = [lot.locationName];
  if (isLot) {
    parts.push(
      lot.qtyReceived === null
        ? formatStockQty(lot.onHandQty, unit)
        : t("stock.lot.received", {
            qty: formatStockQty(lot.onHandQty, unit),
            received: formatStockQty(lot.qtyReceived, unit),
          }),
    );
    if (lot.receivedOn) {
      parts.push(t("stock.lot.receivedOn", { date: formatCalendarDate(lot.receivedOn) }));
    }
    if (lot.supplierName) parts.push(lot.supplierName);
  } else {
    parts.push(formatStockQty(lot.onHandQty, unit));
  }
  return (
    <LedgerRow className="flex flex-col gap-1.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold [overflow-wrap:anywhere]">
          {isLot ? (lot.lotCode ?? t("stock.lot.noCode")) : t("stock.noLot")}
        </span>
        {expiry && <Badge tone={expiry.tone}>{expiry.label}</Badge>}
      </div>
      <p className="num text-sm text-ink-muted [overflow-wrap:anywhere]">{parts.join(" · ")}</p>
    </LedgerRow>
  );
}
