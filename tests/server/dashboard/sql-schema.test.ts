import { describe, expect, it } from "vitest";
import { adminSqlSchema, dashboardSqlSchema, ownerSqlSchema } from "@/server/dashboard/sql-schema";
import { adminSql, ownerSql } from "../../fixtures/dashboard-sql";

describe("the SQL document of dashboard_summary()", () => {
  it("the owner fixture parses with the owner schema", () => {
    expect(ownerSqlSchema.safeParse(ownerSql()).success).toBe(true);
  });

  it("the admin fixture parses with the admin schema", () => {
    expect(adminSqlSchema.safeParse(adminSql()).success).toBe(true);
  });

  it("the union picks the schema by role", () => {
    expect(dashboardSqlSchema.safeParse(ownerSql()).success).toBe(true);
    expect(dashboardSqlSchema.safeParse(adminSql()).success).toBe(true);
    expect(dashboardSqlSchema.safeParse({ ...adminSql(), role: "chef" }).success).toBe(false);
  });

  it("an admin document with fixedCosts, or any extra key, fails", () => {
    const withFixed = { ...adminSql(), fixedCosts: ownerSql().fixedCosts };
    expect(dashboardSqlSchema.safeParse(withFixed).success).toBe(false);
    expect(
      dashboardSqlSchema.safeParse({ ...adminSql(), alertsOpen: { count: 1, more: false } })
        .success,
    ).toBe(false);
    expect(dashboardSqlSchema.safeParse({ ...adminSql(), extra: 1 }).success).toBe(false);
  });

  it("comingSoon accepts only pushList", () => {
    expect(dashboardSqlSchema.safeParse({ ...adminSql(), comingSoon: ["pushList"] }).success).toBe(
      true,
    );
    expect(dashboardSqlSchema.safeParse({ ...adminSql(), comingSoon: [] }).success).toBe(true);
    for (const old of ["covers", "revenue", "averageSpend"]) {
      expect(dashboardSqlSchema.safeParse({ ...adminSql(), comingSoon: [old] }).success).toBe(
        false,
      );
    }
  });

  it("both roles need the yesterday block, and it is strict", () => {
    const { yesterday: _y, ...noYesterday } = adminSql();
    expect(dashboardSqlSchema.safeParse(noYesterday).success).toBe(false);
    const extra = { ...adminSql(), yesterday: { ...adminSql().yesterday, cost: 1 } };
    expect(dashboardSqlSchema.safeParse(extra).success).toBe(false);
    const nested = adminSql();
    (nested.yesterday.compare as Record<string, unknown>).margin = 1;
    expect(dashboardSqlSchema.safeParse(nested).success).toBe(false);
    expect(dashboardSqlSchema.safeParse(ownerSql()).success).toBe(true);
  });

  it("yesterday needs byService (M25c), and each entry is strict", () => {
    const { byService: _b, ...rest } = adminSql().yesterday;
    expect(dashboardSqlSchema.safeParse({ ...adminSql(), yesterday: rest }).success).toBe(false);
    const extra = adminSql();
    Object.assign(extra.yesterday.byService[0]!, { foodCostEur: 4.2 });
    expect(dashboardSqlSchema.safeParse(extra).success).toBe(false);
    const missing = adminSql();
    delete (missing.yesterday.byService[0] as Partial<(typeof missing.yesterday.byService)[number]>)
      .covers;
    expect(dashboardSqlSchema.safeParse(missing).success).toBe(false);
    const none = adminSql();
    none.yesterday.byService = [];
    expect(dashboardSqlSchema.safeParse(none).success).toBe(true);
  });

  it("yesterday accepts the nulls of a day without covers or costed lines", () => {
    const doc = adminSql();
    Object.assign(doc.yesterday, {
      covers: 0,
      tables: 0,
      avgSpendPerCoverEur: null,
      avgTicketEur: null,
      foodCostPct: null,
      costedSharePct: null,
    });
    Object.assign(doc.yesterday.delta, { avgSpendPerCoverEur: null, foodCostPct: null });
    expect(dashboardSqlSchema.safeParse(doc).success).toBe(true);
  });

  it("an owner document missing names fails", () => {
    const { names: _names, ...noNames } = ownerSql();
    expect(dashboardSqlSchema.safeParse(noNames).success).toBe(false);
  });

  it("a cost key injected into a row of a list is stripped, not passed on", () => {
    const owner = ownerSql();
    (owner.plates.worst[0] as Record<string, unknown>).unitCost = 1.2;
    const admin = adminSql();
    (admin.plates.worst[0] as Record<string, unknown>).fullCost = 9;
    for (const doc of [owner, admin]) {
      const parsed = dashboardSqlSchema.safeParse(doc);
      expect(parsed.success).toBe(true);
      expect(JSON.stringify(parsed.data)).not.toMatch(/unitCost|fullCost/);
    }
  });

  it("a key injected into a block (not a row) fails", () => {
    const doc = adminSql();
    (doc.plates as Record<string, unknown>).fixedCostTotal = 9;
    expect(dashboardSqlSchema.safeParse(doc).success).toBe(false);
  });

  it("today must be the manager counts of PR B", () => {
    const doc = ownerSql();
    doc.today = { batchesUseBy: 1, countOpen: false } as never;
    expect(dashboardSqlSchema.safeParse(doc).success).toBe(false);
  });

  it("a negative amount or a bad date is refused", () => {
    const doc = ownerSql();
    doc.payables.overdue.amountEur = -1;
    expect(dashboardSqlSchema.safeParse(doc).success).toBe(false);
    const doc2 = ownerSql();
    doc2.waste.from = "09/11/2026";
    expect(dashboardSqlSchema.safeParse(doc2).success).toBe(false);
  });
  it("a lot with no code, a half portion and an extreme percentage still parse", () => {
    const doc = ownerSql();
    (doc.stockAtRisk.expiringLots.items[0] as { lotCode: string | null }).lotCode = null;
    doc.stockAtRisk.expiringBatches.items[0]!.portions = 3.5;
    doc.plates.worst[0]!.gpPct = -3900;
    doc.foodCost.overallPct = 1450.25;
    const parsed = ownerSqlSchema.safeParse(doc);
    expect(parsed.success).toBe(true);
  });

  it("still refuses a non-finite percentage, a negative portion count and a batch with no code", () => {
    const negative = ownerSql();
    negative.stockAtRisk.expiringBatches.items[0]!.portions = -1;
    expect(ownerSqlSchema.safeParse(negative).success).toBe(false);
    const noBatchCode = ownerSql();
    (noBatchCode.stockAtRisk.expiringBatches.items[0] as { lotCode: string | null }).lotCode = null;
    expect(ownerSqlSchema.safeParse(noBatchCode).success).toBe(false);
    const infinite = ownerSql();
    infinite.foodCost.overallPct = Number.POSITIVE_INFINITY;
    expect(ownerSqlSchema.safeParse(infinite).success).toBe(false);
  });
});

describe("the pushList block (M23)", () => {
  it("is required for both roles", () => {
    const { pushList: _omitted, ...without } = adminSql() as Record<string, unknown>;
    void _omitted;
    expect(dashboardSqlSchema.safeParse(without).success).toBe(false);
    const { pushList: _o2, ...ownerWithout } = ownerSql() as Record<string, unknown>;
    void _o2;
    expect(dashboardSqlSchema.safeParse(ownerWithout).success).toBe(false);
  });

  it("accepts an empty list with the expired counts", () => {
    const doc = {
      ...adminSql(),
      pushList: { count: 0, expired: { batches: 2, lots: 1 }, items: [] },
    };
    expect(dashboardSqlSchema.safeParse(doc).success).toBe(true);
  });

  it("refuses a stray key on a row, more than five rows and a missing expired block", () => {
    const base = adminSql() as { pushList: { count: number; expired: unknown; items: unknown[] } };
    const row = base.pushList.items[0] as Record<string, unknown>;
    const withKey = { ...base, pushList: { ...base.pushList, items: [{ ...row, unit_cost: 1 }] } };
    expect(dashboardSqlSchema.safeParse(withKey).success).toBe(false);
    const six = {
      ...base,
      pushList: { ...base.pushList, items: Array.from({ length: 6 }, () => row) },
    };
    expect(dashboardSqlSchema.safeParse(six).success).toBe(false);
    const noExpired = { ...base, pushList: { count: 0, items: [] } };
    expect(dashboardSqlSchema.safeParse(noExpired).success).toBe(false);
  });
});
