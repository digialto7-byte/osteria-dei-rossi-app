import type { SupabaseClient } from "@supabase/supabase-js";
import { mapBatchDbError } from "./errors";
import { produceResult } from "./output";
import type { ProduceBody } from "./schemas";
import type { ProduceResult } from "./types";

/**
 * POST /api/batches: records a production. public.produce_batch does everything in one transaction (validation,
 * FEFO consumption of the confirmed quantities, the explicit unlotted shortfall, the lot code, the batch with its
 * links to the raw lots, the frozen cost and the portions); this only passes the body and words the answer.
 */
export async function produceBatch(supabase: SupabaseClient, body: ProduceBody) {
  const { data, error } = await supabase.rpc("produce_batch", {
    p_recipe_id: body.recipeId,
    p_output_qty: body.outputQty,
    p_inputs: body.inputs.map((input) => ({
      ingredientId: input.ingredientId,
      qty: input.qty,
      unit: input.unit,
      ...(input.locationId ? { locationId: input.locationId } : {}),
      ...(input.lotId ? { lotId: input.lotId } : {}),
    })),
    p_portions: body.portions ?? null,
    p_shelf_life_hours: body.shelfLifeHours ?? null,
    p_location: body.locationId ?? null,
  });
  if (error) throw mapBatchDbError(error);
  const r = data as ProduceResult;
  return produceResult.parse({
    batchId: r.batchId,
    lotCode: r.lotCode,
    recipe: { key: r.recipe.key, id: r.recipe.id, version: r.recipe.version, name: r.recipe.name },
    producedAt: r.producedAt,
    useBy: r.useBy,
    outputQty: r.outputQty,
    outputUnit: r.outputUnit,
    portionsComputed: r.portionsComputed,
    portions: r.portions,
    shelfLifeHours: r.shelfLifeHours,
    locationId: r.locationId,
    inputs: r.inputs.map((i) => ({
      ingredientId: i.ingredientId,
      locationId: i.locationId,
      qty: i.qty,
      movements: i.movements.map((m) => ({ id: m.id, rawLotId: m.rawLotId, qty: m.qty })),
    })),
    negatives: r.negatives.map((n) => ({
      ingredientId: n.ingredientId,
      locationId: n.locationId,
      onHandQty: n.onHandQty,
    })),
  });
}
