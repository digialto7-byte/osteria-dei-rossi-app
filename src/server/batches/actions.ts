import type { SupabaseClient } from "@supabase/supabase-js";
import { mapBatchDbError } from "./errors";
import { adjustResult, discardResult, splitResult } from "./output";
import type { AdjustBody, DiscardBody, SplitBody } from "./schemas";
import type { AdjustResult, DiscardResult, SplitResult } from "./types";

// The three batch actions (M15 plan §3.4). Each is one RPC, which is one transaction (row lock, fresh read of the
// remaining portions, the movement(s), the state); this only passes the body and words the answer, field by field.
// The € value of a discard is not here: the chef reads these answers, and the owner's report values it at read time.

/** POST /api/batches/:id/adjust: sets the portions actually found; one `count` movement of the difference, or none. */
export async function adjustBatch(supabase: SupabaseClient, batchId: string, body: AdjustBody) {
  const { data, error } = await supabase.rpc("adjust_batch", {
    p_batch: batchId,
    p_counted: body.counted,
  });
  if (error) throw mapBatchDbError(error);
  const r = data as AdjustResult;
  return adjustResult.parse({
    batchId: r.batchId,
    movementId: r.movementId,
    delta: r.delta,
    portionsRemaining: r.portionsRemaining,
    state: r.state,
  });
}

/** POST /api/batches/:id/discard: throws portions away with a reason; one `waste` movement. */
export async function discardBatch(supabase: SupabaseClient, batchId: string, body: DiscardBody) {
  const { data, error } = await supabase.rpc("discard_batch", {
    p_batch: batchId,
    p_portions: body.portions,
    p_reason: body.reason,
  });
  if (error) throw mapBatchDbError(error);
  const r = data as DiscardResult;
  return discardResult.parse({
    batchId: r.batchId,
    movementId: r.movementId,
    portions: r.portions,
    reasonCode: r.reasonCode,
    portionsRemaining: r.portionsRemaining,
    state: r.state,
  });
}

/** POST /api/batches/:id/split: moves whole portions into a new batch with its own lot code, use-by and location. */
export async function splitBatch(supabase: SupabaseClient, batchId: string, body: SplitBody) {
  const { data, error } = await supabase.rpc("split_batch", {
    p_batch: batchId,
    p_portions: body.portions,
    p_hours_from_now: body.hoursFromNow,
    p_location: body.locationId ?? null,
  });
  if (error) throw mapBatchDbError(error);
  const r = data as SplitResult;
  return splitResult.parse({
    batchId: r.batchId,
    newBatchId: r.newBatchId,
    lotCode: r.lotCode,
    portions: r.portions,
    producedAt: r.producedAt,
    useBy: r.useBy,
    shelfLifeHours: r.shelfLifeHours,
    locationId: r.locationId,
    portionsRemaining: r.portionsRemaining,
    state: r.state,
  });
}
