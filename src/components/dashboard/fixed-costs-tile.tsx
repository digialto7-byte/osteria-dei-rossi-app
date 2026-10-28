import { Tile } from "@/components/dashboard/tile";
import { Muted } from "@/components/ui";
import { formatEur, monthLabel, tileEmpty } from "@/lib/dashboard/dashboard-view";
import { t } from "@/lib/i18n";
import type { OwnerDashboard } from "@/server/dashboard/output";

type FixedCosts = OwnerDashboard["tiles"]["fixedCosts"];

/** The fixed costs of the month and what each plate carries, if sales allow it (owner only, never the admin). */
export function FixedCostsTile({ tile }: { tile: FixedCosts }) {
  const empty = tileEmpty("fixedCosts", { fixedCosts: tile });
  return (
    <Tile
      tileKey="fixedCosts"
      title={t("dashboard.tile.fixedCosts")}
      href={tile.href}
      linkLabel={t("dashboard.link.fixedCosts")}
    >
      {empty || tile.monthlyTotalEur === null || tile.periodMonth === null ? (
        <Muted>{t(empty ?? "dashboard.empty.fixedCosts")}</Muted>
      ) : (
        <>
          <p className="num text-xl font-bold">
            {t("dashboard.fixedCosts.monthly", {
              amount: formatEur(tile.monthlyTotalEur),
              month: monthLabel(tile.periodMonth),
            })}
          </p>
          <p className="num text-ink-muted">
            {tile.perPlateEur === null
              ? t("dashboard.fixedCosts.unallocated")
              : t("dashboard.fixedCosts.perPlate", { amount: formatEur(tile.perPlateEur) })}
          </p>
        </>
      )}
    </Tile>
  );
}
