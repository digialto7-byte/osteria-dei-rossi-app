import { Tile } from "@/components/dashboard/tile";
import { Badge, Muted } from "@/components/ui";
import { formatEur, formatPct, tileEmpty } from "@/lib/dashboard/dashboard-view";
import { t } from "@/lib/i18n";
import {
  compareLabel,
  deltaWords,
  formatDelta,
  formatDeltaPct,
  yesterdayHint,
  yesterdayTitle,
} from "@/lib/reports/report-view";
import type { AdminDashboard } from "@/server/dashboard/output";

type Yesterday = AdminDashboard["tiles"]["yesterday"];
type Pair = Yesterday["delta"]["covers"];

const DASH = "—";

/** One figure with its comparison: the value, then "mercoledì scorso 2 · +3 in più". The database computed the delta; this only prints it. */
function Figure({
  label,
  value,
  compare,
  change,
}: {
  label: string;
  value: string;
  compare: string | null;
  change: string;
}) {
  return (
    <div className="flex flex-col">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-[1.25rem] leading-tight font-bold text-ink">{value}</span>
        {compare ? <span className="text-ink-muted">{`${compare}${change}`}</span> : null}
      </dd>
    </div>
  );
}

/** " · +3 in più", " · +162,1 % in più", "" when there is nothing to compare with. */
function change(pair: Pair, text: (abs: number, pct: number | null) => string): string {
  if (pair === null) return "";
  const body = text(pair.abs, pair.pct);
  if (body === "") return "";
  const words = deltaWords(pair.abs);
  return ` · ${body}${words ? ` ${words}` : ""}`;
}

/**
 * The "Ieri" tile (M22): yesterday's covers, net revenue, spend per cover, ticket and food cost %, each next to the same weekday a week
 * before. The figures are final once the nightly rollup has run; until then the tile says "Provvisorio". The food cost % is on the dishes
 * whose cost is known, and the hint says on how much. Every value comes from the database; nothing here adds or divides.
 */
export function YesterdayTile({ tile }: { tile: Yesterday }) {
  const empty = tileEmpty("yesterday", { yesterday: tile });
  const compare = compareLabel(tile.compare.businessDate);
  const eur = (value: number | null) => (value === null ? DASH : formatEur(value));
  const pctText = (_abs: number, pct: number | null) => formatDeltaPct(pct);
  return (
    <Tile
      tileKey="yesterday"
      title={yesterdayTitle(tile.businessDate)}
      href={tile.href}
      linkLabel={t("dashboard.link.yesterday")}
    >
      {tile.final ? null : <Badge tone="warning">{t("dashboard.yesterday.provisional")}</Badge>}
      {empty ? (
        <Muted>{t(empty)}</Muted>
      ) : (
        <>
          <dl className="flex flex-col gap-3">
            <Figure
              label={t("dashboard.yesterday.covers")}
              value={String(tile.covers)}
              compare={`${compare} ${tile.compare.covers}`}
              change={change(tile.delta.covers, (abs) => formatDelta(abs, null))}
            />
            <Figure
              label={t("dashboard.yesterday.net")}
              value={formatEur(tile.revenueNetEur)}
              compare={`${compare} ${formatEur(tile.compare.revenueNetEur)}`}
              change={change(tile.delta.revenueNetEur, pctText)}
            />
            <Figure
              label={t("dashboard.yesterday.spend")}
              value={eur(tile.avgSpendPerCoverEur)}
              compare={`${compare} ${eur(tile.compare.avgSpendPerCoverEur)}`}
              change={change(tile.delta.avgSpendPerCoverEur, pctText)}
            />
            <Figure
              label={t("dashboard.yesterday.ticket")}
              value={eur(tile.avgTicketEur)}
              compare={`${compare} ${eur(tile.compare.avgTicketEur)}`}
              change={change(tile.delta.avgTicketEur, pctText)}
            />
            <Figure
              label={t("dashboard.yesterday.foodCost")}
              value={tile.foodCostPct === null ? DASH : formatPct(tile.foodCostPct)}
              compare={
                tile.compare.foodCostPct === null
                  ? null
                  : `${compare} ${formatPct(tile.compare.foodCostPct)}`
              }
              change={change(tile.delta.foodCostPct, (abs) => formatDelta(abs, null))}
            />
          </dl>
          {tile.foodCostPct === null ? null : (
            <Muted>{yesterdayHint(tile.costedRevenueNetEur, tile.revenueNetEur)}</Muted>
          )}
        </>
      )}
    </Tile>
  );
}
