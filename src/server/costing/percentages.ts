import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrapCost } from "./errors";
import type { ChefPlateStatus, PlateMarginPct } from "./types";

// V6.2: the chef's only cost-derived response. Every item is built key by key from the four
// columns of plate_margins_pct() plus the name and target GP% the chef already reads (M7), so a
// column added to the function later cannot leak through here.

export interface MarginRow {
  recipe_key: string;
  food_cost_pct: number | null;
  gp_pct: number | null;
  status: string;
}

const CHEF_STATUSES: readonly string[] = ["ok", "below_target", "incomplete"];

export function buildPlateMarginPcts(
  rows: readonly MarginRow[],
  names: ReadonlyMap<string, string>,
  targets: ReadonlyMap<string, number | null>,
): PlateMarginPct[] {
  const items: PlateMarginPct[] = [];
  for (const row of rows) {
    const name = names.get(row.recipe_key);
    if (name === undefined) continue;
    items.push({
      recipeKey: row.recipe_key,
      name,
      foodCostPct: row.food_cost_pct,
      gpPct: row.gp_pct,
      targetGpPct: targets.get(row.recipe_key) ?? null,
      // Fail closed: a state the chef must not see reads as incomplete.
      status: (CHEF_STATUSES.includes(row.status) ? row.status : "incomplete") as ChefPlateStatus,
    });
  }
  return items.sort(
    (a, b) => a.name.localeCompare(b.name, "it") || a.recipeKey.localeCompare(b.recipeKey),
  );
}

export async function getPlateMarginPcts(
  supabase: SupabaseClient,
): Promise<{ plates: PlateMarginPct[] }> {
  const rows = unwrapCost<MarginRow[] | null>(await supabase.rpc("plate_margins_pct")) ?? [];
  if (rows.length === 0) return { plates: [] };
  const keys = rows.map((row) => row.recipe_key);
  const current =
    unwrapCost<{ id: string; recipe_key: string; name: string }[] | null>(
      await supabase.from("v_recipe_current").select("id, recipe_key, name").in("recipe_key", keys),
    ) ?? [];
  const prices =
    unwrapCost<{ recipe_id: string; target_gp_pct: number | null }[] | null>(
      await supabase
        .from("recipe_price")
        .select("recipe_id, target_gp_pct")
        .in(
          "recipe_id",
          current.map((row) => row.id),
        ),
    ) ?? [];
  const targetByVersion = new Map(prices.map((row) => [row.recipe_id, row.target_gp_pct]));
  return {
    plates: buildPlateMarginPcts(
      rows,
      new Map(current.map((row) => [row.recipe_key, row.name])),
      new Map(current.map((row) => [row.recipe_key, targetByVersion.get(row.id) ?? null])),
    ),
  };
}
