import type { SupabaseClient } from "@supabase/supabase-js";
import { mapStockDbError } from "./errors";
import { transferResponse } from "./output";
import type { TransferBody } from "./schemas";
import type { TransferResult } from "./types";

/** POST /api/stock/transfers: moves stock between two locations, lot by lot (public.post_transfer). */
export async function postTransfer(supabase: SupabaseClient, body: TransferBody) {
  const { data, error } = await supabase.rpc("post_transfer", {
    p_ingredient: body.ingredientId,
    p_qty: body.qty,
    p_unit: body.unit,
    p_from: body.fromLocationId,
    p_to: body.toLocationId,
    p_lot: body.lotId ?? null,
  });
  if (error) throw mapStockDbError(error);
  const result = data as TransferResult;
  return transferResponse.parse({
    operationId: result.operationId,
    movements: result.movements.map((m) => ({
      id: m.id,
      rawLotId: m.rawLotId,
      locationId: m.locationId,
      qty: m.qty,
    })),
    fromOnHandQty: result.fromOnHandQty,
    toOnHandQty: result.toOnHandQty,
  });
}
