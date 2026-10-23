import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantSession } from "@/lib/api/with-api";
import { unwrapCost } from "./errors";
import { nameLookup } from "./names";
import type { FixedCostStatus, MissingIngredient, PlateCost, PlateStatus } from "./types";

export interface PlateCostRow {
  recipe_key: string;
  name: string;
  version: number;
  food_cost_eur: number | null;
  fixed_cost_eur: number | null;
  full_cost_eur: number | null;
  sale_price_eur: number | null;
  vat_pct: number;
  sale_price_ex_vat_eur: number | null;
  gross_margin_eur: number | null;
  net_margin_eur: number | null;
  food_cost_pct: number | null;
  gp_pct: number | null;
  target_gp_pct: number | null;
  fixed_cost_allocated: boolean | null;
  status: PlateStatus;
  reasons: string[] | null;
  missing_ingredient_ids: string[] | null;
}

/** `plate_costs` columns to the API shape (snake to camel; the ingredient names are looked up by the caller). */
export function mapPlateRow(row: PlateCostRow, missing: MissingIngredient[]): PlateCost {
  return {
    recipeKey: row.recipe_key,
    name: row.name,
    version: row.version,
    foodCostEur: row.food_cost_eur,
    fixedCostEur: row.fixed_cost_eur,
    fullCostEur: row.full_cost_eur,
    salePriceEur: row.sale_price_eur,
    vatPct: row.vat_pct,
    salePriceExVatEur: row.sale_price_ex_vat_eur,
    grossMarginEur: row.gross_margin_eur,
    netMarginEur: row.net_margin_eur,
    foodCostPct: row.food_cost_pct,
    gpPct: row.gp_pct,
    targetGpPct: row.target_gp_pct,
    fixedCostAllocated: row.fixed_cost_allocated,
    status: row.status,
    reasons: row.reasons ?? [],
    missingIngredients: missing,
  };
}

export interface PlatesResponse {
  at: string | null;
  fixedCost: FixedCostStatus | null;
  plates: PlateCost[];
}

/**
 * Every active plate with its costs on `at` (null = now). Fixed costs are owner only (founder
 * 2026-10-23): for the admin the fixed cost status is never requested and the database already
 * nulls the fixed-cost fields of each plate.
 */
export async function getPlateCosts(
  supabase: SupabaseClient,
  session: TenantSession,
  at: string | null,
): Promise<PlatesResponse> {
  const rows =
    unwrapCost<PlateCostRow[] | null>(await supabase.rpc("plate_costs", { p_date: at })) ?? [];
  const fixedCost =
    session.role === "owner"
      ? unwrapCost<FixedCostStatus>(await supabase.rpc("fixed_cost_status", { p_date: at }))
      : null;
  const missing = await nameLookup(
    supabase,
    rows.map((row) => row.missing_ingredient_ids),
  );
  return {
    at,
    fixedCost,
    plates: rows.map((row) => mapPlateRow(row, missing(row.missing_ingredient_ids))),
  };
}
