import { Badge, LedgerList, LedgerRow, Muted } from "@/components/ui";
import { formatEur, formatPct } from "@/lib/dashboard/dashboard-view";
import { formatWeight } from "@/lib/format/weight";
import { t } from "@/lib/i18n";
import { itemStatusLabel } from "@/lib/reports/report-view";
import { formatNumber } from "@/lib/units/format";
import type { ItemsOutput } from "@/server/reports/output";

type OwnerRow = Extract<ItemsOutput, { role: "owner" }>["rows"][number];

/** The owner's extra figures, when the row carries them: the keys exist only in the owner's payload (Q107). */
function ownerFigures(row: ItemsOutput["rows"][number]): string[] {
  if (!("fixedCostPerPlateEur" in row)) return [];
  const owner = row as OwnerRow;
  const parts: string[] = [];
  if (owner.fixedCostPerPlateEur !== null) {
    parts.push(t("report.items.fixed", { amount: formatEur(owner.fixedCostPerPlateEur) }));
  }
  if (owner.grossMarginPerPlateEur !== null) {
    parts.push(t("report.items.gross", { amount: formatEur(owner.grossMarginPerPlateEur) }));
  }
  if (owner.contributionEur !== null) {
    parts.push(t("report.items.contribution", { amount: formatEur(owner.contributionEur) }));
  }
  return parts;
}

/**
 * A weighted item sells one plate per line, so its figures "per plate" are per line: the row also says the weight sold and the
 * average weight per plate (D-8). Both come from the reply, only on rows that have them.
 */
function weightFigures(row: ItemsOutput["rows"][number]): string[] {
  const parts: string[] = [];
  if (row.weightG !== null) {
    parts.push(
      t("report.items.weight", { weight: formatWeight(row.weightG, "it", { kgDecimals: 2 }) }),
    );
  }
  if (row.avgWeightG !== null) {
    parts.push(
      t("report.items.avgWeight", {
        weight: formatWeight(row.avgWeightG, "it", { kgDecimals: 2 }),
      }),
    );
  }
  return parts;
}

/**
 * The plates view (M22 plan §3.6): one row per item with plates, mix, net revenue, food cost % and margin per plate; the owner's rows add the
 * fixed cost, the gross margin and the contribution. A badge says what needs attention (no recipe, incomplete or partial cost). The totals row
 * repeats the period's food cost %, which is the KPI report's. Nothing here adds or divides.
 */
export function ItemsPanel({ items }: { items: ItemsOutput }) {
  const totals = items.totals;
  if (items.rows.length === 0) return <Muted>{t("report.items.empty")}</Muted>;
  return (
    <div className="flex flex-col gap-3">
      <LedgerList>
        {items.rows.map((row) => {
          const badge = itemStatusLabel(row.status);
          const parts = [
            t("report.items.plates", { qty: formatNumber(row.plates) }),
            row.mixPct === null ? null : t("report.items.mix", { pct: formatPct(row.mixPct) }),
            t("report.items.revenue", { amount: formatEur(row.revenueNetEur) }),
            row.foodCostPct === null
              ? null
              : t("report.items.foodCost", { pct: formatPct(row.foodCostPct) }),
            row.foodMarginPerPlateEur === null
              ? null
              : t("report.items.margin", { amount: formatEur(row.foodMarginPerPlateEur) }),
            ...weightFigures(row),
            ...ownerFigures(row),
          ].filter((part): part is string => part !== null);
          return (
            <LedgerRow
              key={row.menuItemId}
              data-menu-item-id={row.menuItemId}
              className="flex flex-col gap-1 py-3"
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{row.name}</span>
                {badge ? <Badge tone="warning">{badge}</Badge> : null}
              </span>
              <span className="text-ink-muted">{parts.join(" · ")}</span>
            </LedgerRow>
          );
        })}
      </LedgerList>
      <p data-testid="items-total" className="font-bold tabular-nums">
        {totals.foodCostPct === null
          ? t("report.items.totalNoPct", { plates: formatNumber(totals.plates) })
          : t("report.items.total", {
              plates: formatNumber(totals.plates),
              pct: formatPct(totals.foodCostPct),
            })}
      </p>
    </div>
  );
}
