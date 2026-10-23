import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/errors";
import { venueDate } from "@/lib/time/venue-date";
import { UNITS_FOR_BASE } from "./constants";
import { mapStockDbError } from "./errors";
import { lotsResponse } from "./output";
import type { BaseUnit, StockLotRow } from "./types";

/**
 * GET /api/stock/lots: the lot buckets of one ingredient in FEFO order per location, with what the waste and
 * transfer forms need (the units the ingredient accepts, the active locations, the venue's today). Names are read
 * on the caller's own session, so RLS decides what is visible.
 */
export async function getLots(
  supabase: SupabaseClient,
  query: { ingredient: string; includeEmpty: boolean },
  now: Date = new Date(),
) {
  const lots = await supabase.rpc("stock_lots", {
    p_ingredient: query.ingredient,
    p_include_empty: query.includeEmpty,
  });
  if (lots.error) throw mapStockDbError(lots.error);

  const ingredient = await supabase
    .from("ingredient")
    .select("id, name, base_unit")
    .eq("id", query.ingredient)
    .maybeSingle();
  if (ingredient.error) throw mapStockDbError(ingredient.error);
  const row = ingredient.data as { id: string; name: string; base_unit: BaseUnit } | null;
  if (!row) throw new ApiError(404, "not_found", "Risorsa non trovata.");

  const locations = await supabase
    .from("location")
    .select("id, name")
    .eq("is_active", true)
    .order("name");
  if (locations.error) throw mapStockDbError(locations.error);

  return lotsResponse.parse({
    ingredient: { id: row.id, name: row.name, baseUnit: row.base_unit },
    today: venueDate(now),
    units: [...UNITS_FOR_BASE[row.base_unit]],
    locations: ((locations.data ?? []) as Array<{ id: string; name: string }>).map((l) => ({
      id: l.id,
      name: l.name,
    })),
    lots: ((lots.data ?? []) as StockLotRow[]).map((lot) => ({
      rawLotId: lot.raw_lot_id,
      lotCode: lot.lot_code,
      locationId: lot.location_id,
      locationName: lot.location_name,
      expiry: lot.expiry,
      expiryState: lot.expiry_state,
      receivedOn: lot.received_on,
      supplierName: lot.supplier_name,
      qtyReceived: lot.qty_received,
      onHandQty: lot.on_hand_qty,
      fefoRank: lot.fefo_rank,
    })),
  });
}
