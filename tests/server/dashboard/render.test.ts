import { beforeEach, describe, expect, it, vi } from "vitest";
import { toAlertItem, type AlertRow } from "@/server/alerts/list";
import { renderDashboard } from "@/server/dashboard/render";
import { dashboardSqlSchema } from "@/server/dashboard/sql-schema";
import { adminSql, ING_1, ownerSql, purchaseDueAlert, SUP_1 } from "../../fixtures/dashboard-sql";

const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (e: unknown) => reportError(e) }));

const owner = (doc = ownerSql()) => renderDashboard(dashboardSqlSchema.parse(doc), "it");

beforeEach(() => reportError.mockClear());

describe("renderDashboard", () => {
  it("a purchase_due row renders as /avvisi would render it, with the names from the document", () => {
    const sql = purchaseDueAlert();
    const out = owner();
    if (out.role !== "owner") throw new Error("owner expected");
    const row: AlertRow = {
      id: sql.id,
      kind: sql.kind,
      severity: sql.severity as AlertRow["severity"],
      entity_type: sql.entityType,
      entity_id: sql.entityId,
      business_date: sql.businessDate,
      created_at: sql.createdAt,
      payload: sql.payload,
      cost_bearing: sql.costBearing,
      acknowledged_at: null,
      acknowledged_by: null,
      acknowledger: null,
    };
    const names = {
      ingredient: new Map([[ING_1, "Farina (fixture)"]]),
      location: new Map<string, string>(),
      recipe: new Map<string, string>(),
      supplier: new Map([[SUP_1, "Fornitore Uno (demo)"]]),
      raw_lot: new Map<string, string>(),
      batch: new Map<string, string>(),
    };
    const expected = toAlertItem(row, "it", names);
    expect(out.tiles.todayLists.purchase[0]).toEqual(expected);
    expect(expected.title + expected.body).toContain("Farina (fixture)");
    expect(expected.title + expected.body).toContain("Fornitore Uno (demo)");
    expect(out.tiles.todayLists.purchase[0]?.href).toBe("/riordino/ingredienti");
    expect(out.tiles.todayLists.purchase[0]?.acknowledged).toBeNull();
  });

  it("an acknowledged row keeps its time and never carries a person's name", () => {
    const doc = ownerSql();
    doc.todayLists.purchase = [purchaseDueAlert("2026-11-09T06:30:00.000Z")];
    const out = owner(doc);
    if (out.role !== "owner") throw new Error("owner expected");
    expect(out.tiles.todayLists.purchase[0]?.acknowledged).toEqual({
      at: "2026-11-09T06:30:00.000Z",
      byName: null,
    });
  });

  it("an unknown kind is dropped and reported by kind only", () => {
    const doc = ownerSql();
    doc.todayLists.purchase = [
      { ...purchaseDueAlert(), kind: "mystery_kind", payload: { secret: "do-not-log" } as never },
      purchaseDueAlert(),
    ];
    doc.todayLists.purchaseCount = 2;
    const out = owner(doc);
    if (out.role !== "owner") throw new Error("owner expected");
    expect(out.tiles.todayLists.purchase).toHaveLength(1);
    expect(out.tiles.todayLists.purchaseCount).toBe(2);
    expect(reportError).toHaveBeenCalledTimes(1);
    const reported = String((reportError.mock.calls[0]?.[0] as Error).message);
    expect(reported).toContain("mystery_kind");
    expect(reported).not.toContain("do-not-log");
  });

  it("row links: payable, expiring lot, expiring batch, below minimum", () => {
    const out = owner();
    expect(out.tiles.payables.items[0]?.href).toBe(`/pagamenti/${out.tiles.payables.items[0]?.id}`);
    expect(out.tiles.stockAtRisk.expiringLots.items[0]?.href).toBe(`/magazzino/${ING_1}`);
    const batch = out.tiles.stockAtRisk.expiringBatches.items[0];
    expect(batch?.href).toBe(`/produzione/${batch?.batchId}`);
    expect(out.tiles.stockAtRisk.belowMin.items[0]?.href).toBe("/riordino/ingredienti");
  });

  it("tile links lead to the screens that act on them", () => {
    const out = owner();
    expect(out.tiles.foodCost.href).toBe("/costi");
    expect(out.tiles.plates.href).toBe("/costi");
    expect(out.tiles.payables.href).toBe("/pagamenti");
    expect(out.tiles.stockAtRisk.href).toBe("/magazzino");
    expect(out.tiles.waste.href).toBe("/magazzino/sprechi");
    if (out.role === "owner") {
      expect(out.tiles.priceVariance.href).toBe("/avvisi");
      expect(out.tiles.todayLists.href).toBe("/avvisi");
      expect(out.tiles.fixedCosts.href).toBe("/costi/impostazioni");
    }
  });

  it("owner: the today block has the alerts card first, from alertsOpen; admin: none", () => {
    const o = owner();
    expect(o.today.cards[0]).toEqual({ key: "alerts", count: 7, more: false, href: "/avvisi" });
    const a = renderDashboard(dashboardSqlSchema.parse(adminSql()), "it");
    expect(a.today.cards.map((c) => c.key)).not.toContain("alerts");
  });

  it("the admin output has no owner-only tile", () => {
    const a = renderDashboard(dashboardSqlSchema.parse(adminSql()), "it");
    expect(Object.keys(a.tiles).sort()).toEqual(
      ["foodCost", "payables", "plates", "stockAtRisk", "waste"].sort(),
    );
  });

  it("fixed costs keep the owner's figures and drop platesSold", () => {
    const out = owner();
    if (out.role !== "owner") throw new Error("owner expected");
    expect(out.tiles.fixedCosts).toEqual({
      href: "/costi/impostazioni",
      periodMonth: "2026-11-01",
      monthlyTotalEur: 3000,
      perPlateEur: null,
      reason: "no_sales",
    });
  });

  it("an injected cost key in a plate row never reaches the output", () => {
    const doc = ownerSql();
    (doc.plates.worst[0] as Record<string, unknown>).unit_cost = 1.5;
    const out = owner(doc);
    expect(JSON.stringify(out)).not.toContain("unit_cost");
  });

  it("comingSoon is passed through as keys, with no number", () => {
    expect(owner().comingSoon).toEqual(["covers", "revenue", "averageSpend"]);
  });
});
