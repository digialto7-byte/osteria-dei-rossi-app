import type { SupabaseClient } from "@supabase/supabase-js";
import { mapStockDbError } from "./errors";
import { reverseResponse } from "./output";
import type { ReverseResult } from "./types";

/**
 * POST /api/stock/movements/:id/reverse: reverses the whole operation the movement belongs to
 * (public.reverse_movement); the original rows stay in the history.
 */
export async function reverseMovement(supabase: SupabaseClient, movementId: string) {
  const { data, error } = await supabase.rpc("reverse_movement", { p_movement: movementId });
  if (error) throw mapStockDbError(error);
  const result = data as ReverseResult;
  return reverseResponse.parse({
    operationId: result.operationId,
    reversedOperationId: result.reversedOperationId,
    movements: result.movements.map((m) => ({
      id: m.id,
      rawLotId: m.rawLotId,
      locationId: m.locationId,
      qty: m.qty,
    })),
  });
}
