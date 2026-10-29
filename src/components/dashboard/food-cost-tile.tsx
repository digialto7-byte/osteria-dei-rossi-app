import { Meter } from "@/components/charts/meter";
import { Tile } from "@/components/dashboard/tile";
import { Muted } from "@/components/ui";
import { formatPct, tileEmpty } from "@/lib/dashboard/dashboard-view";
import { t, tn } from "@/lib/i18n";
import type { OwnerDashboard } from "@/server/dashboard/output";

type FoodCost = OwnerDashboard["tiles"]["foodCost"];

/** The menu's food cost %: a figure and a bar, with the honest hint that it is not weighted by sales. */
export function FoodCostTile({ tile }: { tile: FoodCost }) {
  const empty = tileEmpty("foodCost", { foodCost: tile });
  const title = t("dashboard.tile.foodCost");
  return (
    <Tile
      tileKey="foodCost"
      title={title}
      href={tile.href}
      linkLabel={t("dashboard.link.foodCost")}
    >
      {empty || tile.overallPct === null ? (
        <Muted>{t(empty ?? "dashboard.empty.foodCost")}</Muted>
      ) : (
        <>
          <Meter value={tile.overallPct} valueText={formatPct(tile.overallPct)} label={title} />
          <Muted>{t("dashboard.foodCost.hint")}</Muted>
          <p className="text-ink-muted">
            {tn("dashboard.foodCost.basis", tile.platesCounted)}
            {tile.platesIncomplete > 0
              ? ` · ${t("dashboard.foodCost.incomplete", { count: tile.platesIncomplete })}`
              : ""}
          </p>
        </>
      )}
    </Tile>
  );
}
