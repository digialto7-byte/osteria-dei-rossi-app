import type { SupabaseClient } from "@supabase/supabase-js";
import { mapStockDbError } from "./errors";
import { stockResponse } from "./output";
import type { StockItem, StockOnHandRow } from "./types";

// Rounds a sum of 4-decimal quantities back to 4 decimals (0,1 + 0,2 must read 0,3).
const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

/**
 * Pure: the rows of public.stock_on_hand (one per ingredient x location, already ordered by SQL) into one item per
 * ingredient, in the order the rows came. The only arithmetic is the total of an ingredient's locations; the sign
 * tests (`negative`) read the SQL quantities as they are.
 */
export function groupStockItems(rows: readonly StockOnHandRow[]): StockItem[] {
  const items = new Map<string, StockItem>();
  for (const row of rows) {
    let item = items.get(row.ingredient_id);
    if (!item) {
      item = {
        ingredientId: row.ingredient_id,
        name: row.ingredient_name,
        baseUnit: row.base_unit,
        isActive: row.is_active,
        onHandQty: 0,
        negative: false,
        locations: [],
      };
      items.set(row.ingredient_id, item);
    }
    const negative = row.on_hand_qty < 0;
    item.locations.push({
      locationId: row.location_id,
      name: row.location_name,
      onHandQty: row.on_hand_qty,
      unlottedQty: row.unlotted_qty,
      negative,
    });
    item.onHandQty = round4(item.onHandQty + row.on_hand_qty);
    item.negative ||= negative;
  }
  return [...items.values()];
}

/** GET /api/stock: what is in each location, by ingredient (quantities only). */
export async function getStock(
  supabase: SupabaseClient,
  query: { location: string | null },
  now: Date = new Date(),
) {
  const { data, error } = await supabase.rpc("stock_on_hand", { p_location: query.location });
  if (error) throw mapStockDbError(error);
  return stockResponse.parse({
    asOf: now.toISOString(),
    items: groupStockItems((data ?? []) as StockOnHandRow[]),
  });
}
