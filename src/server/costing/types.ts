// The JSON shapes of the cost API (M8 plan §3.6). Every number is computed in Postgres; nothing is
// derived from them in React.

export type CostBasis = "moving_average" | "last_price";
export type PlateStatus = "ok" | "below_target" | "fixed_cost_unallocated" | "incomplete";
export type ChefPlateStatus = "ok" | "below_target" | "incomplete";
export type CostRecipeType = "batch" | "plate" | "sub";

export interface MissingIngredient {
  id: string;
  name: string;
}

export interface PlateCost {
  recipeKey: string;
  name: string;
  version: number;
  foodCostEur: number | null;
  fixedCostEur: number | null;
  fullCostEur: number | null;
  salePriceEur: number | null;
  vatPct: number;
  salePriceExVatEur: number | null;
  grossMarginEur: number | null;
  netMarginEur: number | null;
  foodCostPct: number | null;
  gpPct: number | null;
  targetGpPct: number | null;
  fixedCostAllocated: boolean | null;
  status: PlateStatus;
  reasons: string[];
  missingIngredients: MissingIngredient[];
}

export interface FixedCostStatus {
  periodMonth: string | null;
  monthlyTotalEur: number | null;
  platesSold: number | null;
  perPlateEur: number | null;
  reason: "no_fixed_costs" | "no_sales" | null;
}

export interface CostLine {
  position: number;
  target: { kind: "ingredient" | "recipe"; id: string; name: string };
  qty: number;
  unit: string;
  yieldFactor: number;
  unitCostEur: number | null;
  lineCostEur: number | null;
  incomplete: boolean;
  reason: string | null;
}

export interface RecipeCost {
  recipeKey: string;
  recipeId: string;
  version: number;
  type: CostRecipeType;
  name: string;
  at: string | null;
  totalCostEur: number | null;
  unitCostEur: number | null;
  costUnit: string;
  incomplete: boolean;
  reasons: string[];
  missingIngredients: MissingIngredient[];
  lines: CostLine[];
  plate: PlateCost | null;
}

/** The only keys the chef's response may carry (V6.2). */
export interface PlateMarginPct {
  recipeKey: string;
  name: string;
  foodCostPct: number | null;
  gpPct: number | null;
  targetGpPct: number | null;
  status: ChefPlateStatus;
}

export interface IngredientCost {
  id: string;
  name: string;
  baseUnit: string;
  isActive: boolean;
  basis: CostBasis;
  unitCostEur: number | null;
  avgEur: number | null;
  lastEur: number | null;
  maxEur: number | null;
  purchasesUsed: number;
  lastPurchaseOn: string | null;
}

export interface CostSettings {
  avgCostN: number;
  priceVariancePct: number;
  saleVatPct: number;
}

/** What enter_fixed_costs returns: one monthly entry, totals only (never per person). */
export interface FixedCostEntry {
  id: string;
  /** The first day of the month, YYYY-MM-DD. */
  month: string;
  rentEur: number;
  labourEur: number;
  utilitiesEur: number;
  totalEur: number;
}

export interface FixedCostPeriod extends FixedCostEntry {
  createdAt: string;
  /** True for the newest entry of its month: the figures in force. */
  inForce: boolean;
  /** True for an older entry of a month that was entered again. */
  superseded: boolean;
}
