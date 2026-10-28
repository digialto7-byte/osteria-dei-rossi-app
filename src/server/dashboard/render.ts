import type { Locale } from "@/lib/i18n/locale";
import { reportError } from "@/lib/observability/report";
import { isAlertKind } from "@/server/alerts/kinds";
import { toAlertItem, type AlertRow } from "@/server/alerts/list";
import type { LoadedAlertNames } from "@/server/alerts/names";
import { alertsCard, buildTodaySummary } from "@/server/today/summary";
import type { AdminDashboard, DashboardAlertItem, DashboardOutput, OwnerDashboard } from "./output";
import type { DashboardSql, OwnerSql, SqlAlertRow, SqlNames } from "./sql-schema";

// Pure: the validated SQL document into the answer of GET /api/dashboard. The alert text is rendered by the existing
// templates, so the dashboard reads like /avvisi; the document carries rows and names, never text.

const HREF = {
  foodCost: "/costi",
  plates: "/costi",
  payables: "/pagamenti",
  stockAtRisk: "/magazzino",
  waste: "/magazzino/sprechi",
  priceVariance: "/avvisi",
  todayLists: "/avvisi",
  fixedCosts: "/costi/impostazioni",
} as const;

const toMap = (record: Record<string, string>): ReadonlyMap<string, string> =>
  new Map(Object.entries(record));

function namesOf(names: SqlNames): LoadedAlertNames {
  return {
    ingredient: toMap(names.ingredient),
    location: toMap(names.location),
    recipe: toMap(names.recipe),
    supplier: toMap(names.supplier),
    raw_lot: toMap(names.raw_lot),
    batch: toMap(names.batch),
  };
}

function toRow(sql: SqlAlertRow): AlertRow {
  return {
    id: sql.id,
    kind: sql.kind,
    severity: sql.severity,
    entity_type: sql.entityType,
    entity_id: sql.entityId,
    business_date: sql.businessDate,
    created_at: sql.createdAt,
    payload: sql.payload,
    cost_bearing: sql.costBearing,
    acknowledged_at: sql.acknowledgedAt,
    acknowledged_by: null,
    acknowledger: null,
  };
}

/** Rows of a kind this build does not know are dropped and reported by id and kind only, never by payload. */
function renderAlerts(
  rows: SqlAlertRow[],
  locale: Locale,
  names: LoadedAlertNames,
): DashboardAlertItem[] {
  const items: DashboardAlertItem[] = [];
  for (const row of rows) {
    if (!isAlertKind(row.kind)) {
      reportError(new Error(`Dashboard alert ${row.id}: unknown kind ${row.kind.slice(0, 41)}`));
      continue;
    }
    const item = toAlertItem(toRow(row), locale, names);
    items.push({
      ...item,
      acknowledged: item.acknowledged && { at: item.acknowledged.at, byName: null },
    });
  }
  return items;
}

function sharedTiles(sql: DashboardSql): AdminDashboard["tiles"] {
  return {
    foodCost: { href: HREF.foodCost, ...sql.foodCost },
    plates: { href: HREF.plates, ...sql.plates },
    payables: {
      href: HREF.payables,
      dueSoonDays: sql.payables.dueSoonDays,
      overdue: sql.payables.overdue,
      dueSoon: sql.payables.dueSoon,
      items: sql.payables.items.map((p) => ({ ...p, href: `/pagamenti/${p.id}` })),
    },
    stockAtRisk: {
      href: HREF.stockAtRisk,
      belowMin: {
        count: sql.stockAtRisk.belowMin.count,
        items: sql.stockAtRisk.belowMin.items.map((i) => ({ ...i, href: "/riordino/ingredienti" })),
      },
      expiringLots: {
        count: sql.stockAtRisk.expiringLots.count,
        items: sql.stockAtRisk.expiringLots.items.map((i) => ({
          ...i,
          href: `/magazzino/${i.ingredientId}`,
        })),
      },
      expiringBatches: {
        count: sql.stockAtRisk.expiringBatches.count,
        items: sql.stockAtRisk.expiringBatches.items.map((i) => ({
          ...i,
          href: `/produzione/${i.batchId}`,
        })),
      },
    },
    waste: { href: HREF.waste, ...sql.waste },
  };
}

function renderOwner(sql: OwnerSql, locale: Locale): OwnerDashboard {
  const names = namesOf(sql.names);
  return {
    role: "owner",
    asOf: sql.asOf,
    today: buildTodaySummary(
      sql.today,
      alertsCard(sql.alertsOpen.count, sql.alertsOpen.more),
      "owner",
    ),
    tiles: {
      ...sharedTiles(sql),
      priceVariance: {
        href: HREF.priceVariance,
        count: sql.priceVariance.count,
        items: renderAlerts(sql.priceVariance.items, locale, names),
      },
      todayLists: {
        href: HREF.todayLists,
        businessDate: sql.todayLists.businessDate,
        prepCount: sql.todayLists.prepCount,
        prep: renderAlerts(sql.todayLists.prep, locale, names),
        purchaseCount: sql.todayLists.purchaseCount,
        purchase: renderAlerts(sql.todayLists.purchase, locale, names),
      },
      // platesSold stays in the SQL document; the tile needs only the reason.
      fixedCosts: {
        href: HREF.fixedCosts,
        periodMonth: sql.fixedCosts.periodMonth,
        monthlyTotalEur: sql.fixedCosts.monthlyTotalEur,
        perPlateEur: sql.fixedCosts.perPlateEur,
        reason: sql.fixedCosts.reason,
      },
    },
    comingSoon: sql.comingSoon,
  };
}

export function renderDashboard(sql: DashboardSql, locale: Locale): DashboardOutput {
  if (sql.role === "owner") return renderOwner(sql, locale);
  return {
    role: "admin",
    asOf: sql.asOf,
    today: buildTodaySummary(sql.today, null, "admin"),
    tiles: sharedTiles(sql),
    comingSoon: sql.comingSoon,
  };
}
