import Link from "next/link";
import { Badge, LedgerRow, linkClass } from "@/components/ui";
import { t } from "@/lib/i18n";
import { formatStockQty } from "@/lib/stock/stock-view";
import type { StockItem } from "@/server/stock/types";

/**
 * One ingredient of the stock list: the name as a link, the total at the right edge, a line per location and, when
 * the server says so, a danger badge "Scorta negativa" and a note on the stock booked without a lot. Quantities
 * only, for every role: nothing here is money (Q16 = V6). Every figure is the server's; nothing is added up here.
 */
export function StockRow({ item }: { item: StockItem }) {
  const locations = item.locations
    .map((location) => `${location.name} ${formatStockQty(location.onHandQty, item.baseUnit)}`)
    .join(" · ");
  const unlotted = item.locations.filter((location) => location.unlottedQty < 0);
  return (
    <LedgerRow className="flex flex-col gap-1.5 py-3">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 [overflow-wrap:anywhere]">
          <Link href={`/magazzino/${item.ingredientId}`} className={linkClass}>
            {item.name}
          </Link>
          {!item.isActive && <span className="text-ink-muted"> ({t("stock.inactive")})</span>}
        </span>
        <span className="num shrink-0 font-bold">
          {formatStockQty(item.onHandQty, item.baseUnit)}
        </span>
      </div>
      <p className="num text-sm text-ink-muted">{locations}</p>
      {item.negative && (
        <div>
          <Badge tone="danger">{t("stock.negative")}</Badge>
        </div>
      )}
      {unlotted.map((location) => (
        <p key={location.locationId} className="num text-sm text-ink-muted">
          {t("stock.unlotted", { qty: formatStockQty(location.unlottedQty, item.baseUnit) })}
        </p>
      ))}
    </LedgerRow>
  );
}
