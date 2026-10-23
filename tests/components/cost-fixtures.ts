import type { CostLine, FixedCostPeriod, IngredientCost, PlateCost } from "@/server/costing/types";

export const PLATE: PlateCost = {
  recipeKey: "cc000000-0000-4000-8000-0000000000cc",
  name: "Spezzatino con polenta (demo)",
  version: 2,
  foodCostEur: 2.0567,
  fixedCostEur: null,
  fullCostEur: null,
  salePriceEur: 12,
  vatPct: 10,
  salePriceExVatEur: 10.9091,
  grossMarginEur: 8.8524,
  netMarginEur: null,
  foodCostPct: 18.8542,
  gpPct: 81.1458,
  targetGpPct: 70,
  fixedCostAllocated: false,
  status: "fixed_cost_unallocated",
  reasons: [],
  missingIngredients: [],
};

export const INCOMPLETE_PLATE: PlateCost = {
  ...PLATE,
  recipeKey: "dd000000-0000-4000-8000-0000000000dd",
  name: "Polenta e sale (demo)",
  foodCostEur: null,
  grossMarginEur: null,
  foodCostPct: null,
  gpPct: null,
  status: "incomplete",
  reasons: ["missing_price"],
  missingIngredients: [{ id: "5a", name: "Sale grosso (demo)" }],
};

export const BEEF: IngredientCost = {
  id: "be000000-0000-4000-8000-0000000000be",
  name: "Manzo muscolo (demo)",
  baseUnit: "kg",
  isActive: true,
  basis: "moving_average",
  unitCostEur: 10,
  avgEur: 10,
  lastEur: 11,
  maxEur: 11,
  purchasesUsed: 3,
  lastPurchaseOn: "2026-10-20",
};

export const LINE: CostLine = {
  position: 1,
  target: { kind: "ingredient", id: BEEF.id, name: "Manzo muscolo (demo)" },
  qty: 5,
  unit: "kg",
  yieldFactor: 1,
  unitCostEur: 10,
  lineCostEur: 50,
  incomplete: false,
  reason: null,
};

export const PERIOD: FixedCostPeriod = {
  id: "f1",
  month: "2026-10-01",
  rentEur: 3000,
  labourEur: 9000,
  utilitiesEur: 1500,
  totalEur: 13500,
  createdAt: "2026-10-23T08:00:00+00:00",
  inForce: true,
  superseded: false,
};

/** The markup with non-breaking spaces turned into plain ones, for readable expectations. */
export const plainHtml = (html: string) => html.replace(/ /g, " ");
