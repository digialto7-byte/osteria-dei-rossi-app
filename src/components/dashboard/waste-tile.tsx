import { BarTable } from "@/components/charts/bar-table";
import { Tile } from "@/components/dashboard/tile";
import { Muted } from "@/components/ui";
import { maxValue } from "@/lib/charts/scale";
import { formatEur, tileEmpty, wasteReasonLabel, weekLabel } from "@/lib/dashboard/dashboard-view";
import { t, tn } from "@/lib/i18n";
import type { OwnerDashboard } from "@/server/dashboard/output";

type Waste = OwnerDashboard["tiles"]["waste"];

/** The waste of the current ISO week in euro, by reason. Unpriced waste is counted apart and never shown as 0,00. */
export function WasteTile({ tile }: { tile: Waste }) {
  const empty = tileEmpty("waste", { waste: tile });
  const largest = maxValue(tile.reasons.map((reason) => reason.valueEur));
  return (
    <Tile
      tileKey="waste"
      title={t("dashboard.tile.waste")}
      href={tile.href}
      linkLabel={t("dashboard.link.waste")}
    >
      <Muted>{weekLabel(tile.from, tile.to)}</Muted>
      {empty ? (
        <p className={empty === "dashboard.empty.waste" ? "text-ink-muted" : "font-bold"}>
          {t(empty)}
        </p>
      ) : null}
      {empty ? null : (
        <>
          <p className="num text-3xl font-bold">{formatEur(tile.valueEur)}</p>
          <BarTable
            caption={t("dashboard.waste.caption")}
            max={largest}
            rows={tile.reasons.map((reason) => ({
              key: reason.reasonCode,
              label: wasteReasonLabel(reason.reasonCode),
              valueText: formatEur(reason.valueEur),
              value: reason.valueEur,
            }))}
          />
        </>
      )}
      {tile.unvaluedCount > 0 ? (
        <Muted>{tn("dashboard.waste.unvalued", tile.unvaluedCount)}</Muted>
      ) : null}
    </Tile>
  );
}
