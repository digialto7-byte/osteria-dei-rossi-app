import { Tile } from "@/components/dashboard/tile";
import { Badge, Muted } from "@/components/ui";
import { tileEmpty } from "@/lib/dashboard/dashboard-view";
import { t } from "@/lib/i18n";
import type { DashboardAlertItem, OwnerDashboard } from "@/server/dashboard/output";

type TodayLists = OwnerDashboard["tiles"]["todayLists"];

function List({
  label,
  items,
  count,
}: {
  label: string;
  items: readonly DashboardAlertItem[];
  count: number;
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="font-bold">{label}</h3>
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{item.title}</span>
            {item.acknowledged ? <Badge tone="neutral">{t("dashboard.seen")}</Badge> : null}
          </li>
        ))}
      </ul>
      {count > items.length ? (
        <Muted>{t("dashboard.more", { count: count - items.length })}</Muted>
      ) : null}
    </div>
  );
}

/** Today's prep and purchase lists, from the rule alerts of the venue's business date (owner only). */
export function TodayListsTile({ tile }: { tile: TodayLists }) {
  const empty = tileEmpty("todayLists", { todayLists: tile });
  return (
    <Tile
      tileKey="todayLists"
      title={t("dashboard.tile.todayLists")}
      href={tile.href}
      linkLabel={t("dashboard.link.todayLists")}
    >
      {empty ? (
        <Muted>{t(empty)}</Muted>
      ) : (
        <>
          <List label={t("dashboard.todayLists.prep")} items={tile.prep} count={tile.prepCount} />
          <List
            label={t("dashboard.todayLists.purchase")}
            items={tile.purchase}
            count={tile.purchaseCount}
          />
        </>
      )}
    </Tile>
  );
}
