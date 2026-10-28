import { describe, expect, it } from "vitest";
import {
  comingSoonLabel,
  dueWords,
  formatEur,
  formatPct,
  monthLabel,
  qtyText,
  tileEmpty,
  tileOrder,
  weekLabel,
} from "@/lib/dashboard/dashboard-view";
import { renderDashboard } from "@/server/dashboard/render";
import { dashboardSqlSchema } from "@/server/dashboard/sql-schema";
import { adminSql, ownerSql } from "../../fixtures/dashboard-sql";

describe("formatEur and formatPct", () => {
  it("writes euro the venue's way, with the no-break space", () => {
    expect(formatEur(1234.5)).toMatch(/^1\.234,50\s+€$/);
    expect(formatEur(0)).toMatch(/^0,00\s+€$/);
  });
  it("writes a percentage with two decimals and a space", () => {
    expect(formatPct(28.28)).toMatch(/^28,28\s+%$/);
    expect(formatPct(60)).toMatch(/^60,00\s+%$/);
    expect(formatPct(-10)).toMatch(/^-10,00\s+%$/);
  });
  it("english keeps the same shapes in en-GB", () => {
    expect(formatEur(1234.5, "en")).toMatch(/1,234\.50/);
    expect(formatPct(28.28, "en")).toMatch(/28\.28\s*%/);
  });
});

describe("dueWords", () => {
  it.each([
    [-5, true, "Scaduta da 5 giorni"],
    [-1, true, "Scaduta da 1 giorno"],
    [0, false, "Scade oggi"],
    [1, false, "Scade tra 1 giorno"],
    [7, false, "Scade tra 7 giorni"],
  ])("(%s, %s) is %s", (days, overdue, words) => {
    expect(dueWords(days, overdue)).toBe(words);
  });
});

describe("weekLabel and monthLabel", () => {
  it("names the week in day/month", () => {
    expect(weekLabel("2026-11-09", "2026-11-15")).toBe("Settimana dal 09/11 al 15/11");
    expect(weekLabel("2026-11-09", "2026-11-15", "en")).toBe("Week from 09/11 to 15/11");
  });
  it("names the month of a fixed-cost period", () => {
    expect(monthLabel("2026-11-01")).toBe("novembre 2026");
  });
  it("refuses a date that is not real", () => {
    expect(() => weekLabel("2026-13-40", "2026-11-15")).toThrow();
  });
});

describe("qtyText and comingSoonLabel", () => {
  it("writes a quantity with its unit after a no-break space", () => {
    expect(qtyText(2, "kg")).toBe("2 kg");
    expect(qtyText(0.5, "l")).toBe("0,5 l");
  });
  it.each([
    ["covers", "Coperti"],
    ["revenue", "Incasso"],
    ["averageSpend", "Scontrino medio per coperto"],
  ] as const)("%s is %s", (key, label) => {
    expect(comingSoonLabel(key)).toBe(label);
  });
});

describe("tileOrder", () => {
  it("owner: the nine tiles of the plan, in order", () => {
    expect(tileOrder("owner")).toEqual([
      "todayLists",
      "plates",
      "foodCost",
      "payables",
      "stockAtRisk",
      "waste",
      "priceVariance",
      "fixedCosts",
      "comingSoon",
    ]);
  });
  it("admin: the same without Da fare oggi, Aumenti di prezzo and Costi fissi", () => {
    expect(tileOrder("admin")).toEqual([
      "plates",
      "foodCost",
      "payables",
      "stockAtRisk",
      "waste",
      "comingSoon",
    ]);
  });
});

describe("tileEmpty", () => {
  const owner = () => {
    const out = renderDashboard(dashboardSqlSchema.parse(ownerSql()), "it");
    if (out.role !== "owner") throw new Error("owner expected");
    return out.tiles;
  };

  it("is null for tiles that have content", () => {
    const tiles = owner();
    for (const key of [
      "plates",
      "foodCost",
      "payables",
      "stockAtRisk",
      "waste",
      "priceVariance",
      "todayLists",
    ] as const) {
      expect(tileEmpty(key, tiles)).toBeNull();
    }
  });

  it("todayLists: nothing to prepare or order", () => {
    const tiles = owner();
    tiles.todayLists.prep = [];
    tiles.todayLists.purchase = [];
    tiles.todayLists.prepCount = 0;
    tiles.todayLists.purchaseCount = 0;
    expect(tileEmpty("todayLists", tiles)).toBe("dashboard.empty.todayLists");
  });

  it("plates: none at all, or none with a complete cost", () => {
    const tiles = owner();
    tiles.plates.worst = [];
    expect(tileEmpty("plates", tiles)).toBe("dashboard.empty.platesIncomplete");
    tiles.plates.incomplete = [];
    tiles.plates.incompleteCount = 0;
    expect(tileEmpty("plates", tiles)).toBe("dashboard.empty.plates");
  });

  it("foodCost: no complete plate", () => {
    const tiles = owner();
    tiles.foodCost.overallPct = null;
    expect(tileEmpty("foodCost", tiles)).toBe("dashboard.empty.foodCost");
  });

  it("payables: nothing overdue or due soon", () => {
    const tiles = owner();
    tiles.payables.overdue = { count: 0, amountEur: 0 };
    tiles.payables.dueSoon = { count: 0, amountEur: 0 };
    tiles.payables.items = [];
    expect(tileEmpty("payables", tiles)).toBe("dashboard.empty.payables");
  });

  it("stockAtRisk: all three counts zero", () => {
    const tiles = owner();
    tiles.stockAtRisk.belowMin = { count: 0, items: [] };
    tiles.stockAtRisk.expiringLots = { count: 0, items: [] };
    tiles.stockAtRisk.expiringBatches = { count: 0, items: [] };
    expect(tileEmpty("stockAtRisk", tiles)).toBe("dashboard.empty.stockAtRisk");
  });

  it("waste: nothing recorded, and only unpriced waste is not 'nothing' but 'not available'", () => {
    const tiles = owner();
    Object.assign(tiles.waste, {
      valueEur: 0,
      rawValueEur: 0,
      batchValueEur: 0,
      unvaluedCount: 0,
      reasons: [],
    });
    expect(tileEmpty("waste", tiles)).toBe("dashboard.empty.waste");
    tiles.waste.unvaluedCount = 2;
    expect(tileEmpty("waste", tiles)).toBe("dashboard.empty.wasteUnvalued");
  });

  it("priceVariance and fixedCosts", () => {
    const tiles = owner();
    tiles.priceVariance = { ...tiles.priceVariance, count: 0, items: [] };
    expect(tileEmpty("priceVariance", tiles)).toBe("dashboard.empty.priceVariance");
    tiles.fixedCosts = {
      ...tiles.fixedCosts,
      reason: "no_fixed_costs",
      periodMonth: null,
      monthlyTotalEur: null,
    };
    expect(tileEmpty("fixedCosts", tiles)).toBe("dashboard.empty.fixedCosts");
  });

  it("works on the admin tiles for the tiles the admin has", () => {
    const out = renderDashboard(dashboardSqlSchema.parse(adminSql()), "it");
    expect(tileEmpty("plates", out.tiles)).toBeNull();
  });
});
