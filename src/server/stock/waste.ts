import type { SupabaseClient } from "@supabase/supabase-js";
import { mapStockDbError } from "./errors";
import { outflowResponse } from "./output";
import type { WasteBody } from "./schemas";
import type { OutflowResult } from "./types";

/**
 * POST /api/stock/waste: records a waste with its reason. public.post_waste does everything in one transaction
 * (FEFO, the explicit unlotted shortfall, the cost frozen on the rows, the contained negative-stock alert).
 */
export async function postWaste(supabase: SupabaseClient, body: WasteBody) {
  const { data, error } = await supabase.rpc("post_waste", {
    p_ingredient: body.ingredientId,
    p_qty: body.qty,
    p_unit: body.unit,
    p_reason: body.reason,
    p_location: body.locationId ?? null,
    p_lot: body.lotId ?? null,
  });
  if (error) throw mapStockDbError(error);
  const result = data as OutflowResult;
  return outflowResponse.parse({
    operationId: result.operationId,
    movements: result.movements.map((m) => ({
      id: m.id,
      rawLotId: m.rawLotId,
      locationId: m.locationId,
      qty: m.qty,
    })),
    onHandQty: result.onHandQty,
    negative: result.negative,
  });
}
