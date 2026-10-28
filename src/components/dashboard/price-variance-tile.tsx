import { Tile } from "@/components/dashboard/tile";
import { Badge, Muted } from "@/components/ui";
import { tileEmpty } from "@/lib/dashboard/dashboard-view";
import { t, tn } from "@/lib/i18n";
import type { OwnerDashboard } from "@/server/dashboard/output";

type PriceVariance = OwnerDashboard["tiles"]["priceVariance"];

/** Open price-variance alerts: the count and the newest three, rendered like /avvisi (owner only). */
export function PriceVarianceTile({ tile }: { tile: PriceVariance }) {
  const empty = tileEmpty("priceVariance", { priceVariance: tile });
  return (
    <Tile
      tileKey="priceVariance"
      title={t("dashboard.tile.priceVariance")}
      href={tile.href}
      linkLabel={t("dashboard.link.priceVariance")}
    >
      {empty ? (
        <Muted>{t(empty)}</Muted>
      ) : (
        <>
          <p className="num font-bold">{tn("dashboard.priceVariance.count", tile.count)}</p>
          <ul className="flex flex-col gap-2">
            {tile.items.map((item) => (
              <li key={item.id} className="flex flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{item.title}</span>
                  {item.acknowledged ? <Badge tone="neutral">{t("dashboard.seen")}</Badge> : null}
                </span>
                <span className="text-ink-muted">{item.body}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Tile>
  );
}
