import Link from "next/link";
import { ROW_LINK, Tile } from "@/components/dashboard/tile";
import { Badge, LedgerList, LedgerRow, Muted } from "@/components/ui";
import { portionsText, qtyText, tileEmpty } from "@/lib/dashboard/dashboard-view";
import { formatCalendarDate, formatDateTime } from "@/lib/time/format";
import { t } from "@/lib/i18n";
import type { OwnerDashboard } from "@/server/dashboard/output";

type Stock = OwnerDashboard["tiles"]["stockAtRisk"];
type State = "expired" | "due_soon";

function StateBadge({ state }: { state: State }) {
  return (
    <Badge tone={state === "expired" ? "danger" : "warning"}>
      {t(state === "expired" ? "dashboard.stock.expired" : "dashboard.stock.dueSoon")}
    </Badge>
  );
}

function Group({
  label,
  count,
  shown,
  children,
}: {
  label: string;
  count: number;
  shown: number;
  children: React.ReactNode;
}) {
  if (shown === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="font-bold">
        {label} <span className="num">({count})</span>
      </h3>
      <LedgerList>{children}</LedgerList>
      {count > shown ? <Muted>{t("dashboard.more", { count: count - shown })}</Muted> : null}
    </div>
  );
}

/** Quantities only, no euro: below minimum, lots about to expire, preparations about to expire. */
export function StockRiskTile({ tile }: { tile: Stock }) {
  const empty = tileEmpty("stockAtRisk", { stockAtRisk: tile });
  const { belowMin, expiringLots, expiringBatches } = tile;
  return (
    <Tile
      tileKey="stockAtRisk"
      title={t("dashboard.tile.stockAtRisk")}
      href={tile.href}
      linkLabel={t("dashboard.link.stockAtRisk")}
    >
      {empty ? (
        <Muted>{t(empty)}</Muted>
      ) : (
        <>
          <Group
            label={t("dashboard.stock.belowMin")}
            count={belowMin.count}
            shown={belowMin.items.length}
          >
            {belowMin.items.map((item) => (
              <LedgerRow key={item.ingredientId}>
                <Link href={item.href} className={ROW_LINK}>
                  <span className="num">
                    {t("dashboard.stock.belowMinRow", {
                      name: item.name,
                      onHand: qtyText(item.onHandQty, item.unit),
                      min: qtyText(item.minQty, item.unit),
                    })}
                  </span>
                </Link>
              </LedgerRow>
            ))}
          </Group>
          <Group
            label={t("dashboard.stock.lots")}
            count={expiringLots.count}
            shown={expiringLots.items.length}
          >
            {expiringLots.items.map((item) => (
              <LedgerRow key={item.rawLotId}>
                <Link href={item.href} className={ROW_LINK}>
                  <span className="num">
                    {t(
                      item.lotCode === null
                        ? "dashboard.stock.lotRowNoCode"
                        : "dashboard.stock.lotRow",
                      {
                        name: item.ingredientName,
                        lot: item.lotCode ?? "",
                        qty: qtyText(item.qty, item.unit),
                        date: formatCalendarDate(item.expiry),
                      },
                    )}
                  </span>
                  <StateBadge state={item.state} />
                </Link>
              </LedgerRow>
            ))}
          </Group>
          <Group
            label={t("dashboard.stock.batches")}
            count={expiringBatches.count}
            shown={expiringBatches.items.length}
          >
            {expiringBatches.items.map((item) => (
              <LedgerRow key={item.batchId}>
                <Link href={item.href} className={ROW_LINK}>
                  <span className="num">
                    {t("dashboard.stock.batchRow", {
                      name: item.recipeName,
                      portions: portionsText(item.portions),
                      lot: item.lotCode,
                      date: formatDateTime(new Date(item.useBy)),
                    })}
                  </span>
                  <StateBadge state={item.state} />
                </Link>
              </LedgerRow>
            ))}
          </Group>
        </>
      )}
    </Tile>
  );
}
