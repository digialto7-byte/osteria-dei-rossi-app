import type { SupabaseClient } from "@supabase/supabase-js";
import { STOCK_MOVEMENTS_PAGE_SIZE } from "./constants";
import { mapStockDbError } from "./errors";
import { movementsResponse } from "./output";
import type { MovementsCursor } from "./schemas";
import type { StockOperation } from "./types";

interface MovementsRpc {
  operations: StockOperation[];
  nextCursor: { createdAt: string; id: string } | null;
}

/** GET /api/stock/movements: the history of one ingredient, an operation at a time, newest first. No cost. */
export async function getMovements(
  supabase: SupabaseClient,
  query: { ingredient: string; before: MovementsCursor | null },
) {
  const { data, error } = await supabase.rpc("stock_movements", {
    p_ingredient: query.ingredient,
    p_before_at: query.before?.createdAt ?? null,
    p_before_id: query.before?.id ?? null,
    p_limit: STOCK_MOVEMENTS_PAGE_SIZE,
  });
  if (error) throw mapStockDbError(error);
  const result = data as MovementsRpc;
  return movementsResponse.parse({
    operations: result.operations.map((op) => ({
      operationId: op.operationId,
      handleId: op.handleId,
      type: op.type,
      refType: op.refType,
      reasonCode: op.reasonCode,
      isReversal: op.isReversal,
      reversedByOperationId: op.reversedByOperationId,
      reversible: op.reversible,
      qty: op.qty,
      unit: op.unit,
      lines: op.lines.map((line) => ({
        movementId: line.movementId,
        locationId: line.locationId,
        locationName: line.locationName,
        rawLotId: line.rawLotId,
        lotCode: line.lotCode,
        qty: line.qty,
      })),
      effectiveOn: op.effectiveOn,
      createdAt: op.createdAt,
      byName: op.byName,
      byMe: op.byMe,
    })),
    nextCursor: result.nextCursor ? `${result.nextCursor.createdAt}_${result.nextCursor.id}` : null,
  });
}
