import type { SupabaseClient } from "@supabase/supabase-js";
import { mapBatchDbError } from "./errors";
import { batchDetail } from "./output";
import type { BatchDetail } from "./types";

/**
 * GET /api/batches/:id: one batch with its history, the parts split off it, the defaults of the action forms and what
 * the user can do (public.batch_detail). Quantities and names only, no cost. A foreign or unknown id is a 404.
 * The answer is built field by field, so a column that is not declared can never reach the JSON.
 */
export async function getBatchDetail(supabase: SupabaseClient, batchId: string) {
  const { data, error } = await supabase.rpc("batch_detail", { p_batch: batchId });
  if (error) throw mapBatchDbError(error);
  const d = data as BatchDetail;
  return batchDetail.parse({
    batchId: d.batchId,
    lotCode: d.lotCode,
    recipeKey: d.recipeKey,
    recipeName: d.recipeName,
    version: d.version,
    producedAt: d.producedAt,
    useBy: d.useBy,
    useByState: d.useByState,
    shelfLifeHours: d.shelfLifeHours,
    outputQty: d.outputQty,
    outputUnit: d.outputUnit,
    portionsComputed: d.portionsComputed,
    portionsInitial: d.portionsInitial,
    portionsRemaining: d.portionsRemaining,
    state: d.state,
    locationId: d.locationId,
    locationName: d.locationName,
    byInitials: d.byInitials,
    byMe: d.byMe,
    createdByInitials: d.createdByInitials,
    createdAt: d.createdAt,
    splitFrom: d.splitFrom ? { batchId: d.splitFrom.batchId, lotCode: d.splitFrom.lotCode } : null,
    splits: d.splits.map((s) => ({
      batchId: s.batchId,
      lotCode: s.lotCode,
      portions: s.portions,
      locationName: s.locationName,
    })),
    movements: d.movements.map((m) => ({
      id: m.id,
      type: m.type,
      portions: m.portions,
      reasonCode: m.reasonCode,
      refType: m.refType,
      at: m.at,
      byInitials: m.byInitials,
      byMe: m.byMe,
    })),
    defaults: { hoursLeft: d.defaults.hoursLeft },
    can: { adjust: d.can.adjust, discard: d.can.discard, split: d.can.split },
  });
}
