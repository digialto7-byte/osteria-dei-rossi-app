import Link from "next/link";
import { BarTable, type BarRow } from "@/components/charts/bar-table";
import { Tile } from "@/components/dashboard/tile";
import { Badge, Muted, linkClass } from "@/components/ui";
import { formatPct, moreCount, tileEmpty } from "@/lib/dashboard/dashboard-view";
import { t } from "@/lib/i18n";
import type { OwnerDashboard } from "@/server/dashboard/output";

type Plates = OwnerDashboard["tiles"]["plates"];

function rowOf(plate: Plates["worst"][number]): BarRow {
  const below = plate.status === "below_target";
  const gp = formatPct(plate.gpPct);
  return {
    key: plate.recipeKey,
    label: plate.name,
    valueText:
      plate.targetGpPct === null
        ? t("dashboard.plates.valueNoTarget", { gp })
        : t("dashboard.plates.value", { gp, target: formatPct(plate.targetGpPct) }),
    value: plate.gpPct,
    target: plate.targetGpPct,
    below,
    extra: (
      <Badge tone={below ? "danger" : "success"}>
        {t(below ? "dashboard.plates.below" : "dashboard.plates.ok")}
      </Badge>
    ),
    data: { "data-recipe-key": plate.recipeKey },
  };
}

/** GP % of the worst plates against their targets, then the plates whose cost is incomplete (named, never ranked). */
export function PlatesTile({ tile }: { tile: Plates }) {
  const empty = tileEmpty("plates", { plates: tile });
  const more = moreCount(tile.incompleteCount, tile.incomplete.length);
  return (
    <Tile
      tileKey="plates"
      title={t("dashboard.tile.plates")}
      href={tile.href}
      linkLabel={t("dashboard.link.plates")}
    >
      {empty ? (
        <>
          <Muted>{t(empty)}</Muted>
          {empty === "dashboard.empty.plates" ? (
            <div>
              <Link href="/ricette/nuova" className={linkClass}>
                {t("dashboard.plates.createRecipe")}
              </Link>
            </div>
          ) : null}
        </>
      ) : (
        <BarTable caption={t("dashboard.plates.caption")} rows={tile.worst.map(rowOf)} max={100} />
      )}
      {tile.incompleteCount > 0 ? (
        <div className="flex flex-col gap-1">
          <h3 className="font-bold">{t("dashboard.plates.incomplete")}</h3>
          <ul className="flex flex-col gap-1">
            {tile.incomplete.map((plate) => (
              <li key={plate.recipeKey} data-recipe-key={plate.recipeKey}>
                {plate.name}
              </li>
            ))}
          </ul>
          {more > 0 ? <Muted>{t("dashboard.more", { count: more })}</Muted> : null}
        </div>
      ) : null}
    </Tile>
  );
}
