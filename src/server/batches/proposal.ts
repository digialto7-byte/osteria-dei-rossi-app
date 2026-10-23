import type { SupabaseClient } from "@supabase/supabase-js";
import { mapBatchDbError } from "./errors";
import { batchProposal } from "./output";
import type { BatchProposal } from "./types";

/**
 * GET /api/batches/proposal: the raw quantities of the recipe scaled to the actual output (4 decimals), the portions
 * (rounded down), where each ingredient sits and the use-by preview. Quantities only: public.batch_proposal has no
 * cost, and the answer is built field by field and parsed strictly, so nothing else can get out.
 */
export async function getProposal(
  supabase: SupabaseClient,
  query: { recipeKey: string; outputQty: number | null; shelfLifeHours: number | null },
) {
  const { data, error } = await supabase.rpc("batch_proposal", {
    p_recipe_key: query.recipeKey,
    p_output_qty: query.outputQty,
    p_shelf_life_hours: query.shelfLifeHours,
  });
  if (error) throw mapBatchDbError(error);
  const p = data as BatchProposal;
  return batchProposal.parse({
    recipe: {
      key: p.recipe.key,
      id: p.recipe.id,
      version: p.recipe.version,
      name: p.recipe.name,
      outputQty: p.recipe.outputQty,
      outputUnit: p.recipe.outputUnit,
      portionsPerBatch: p.recipe.portionsPerBatch,
      shelfLifeHours: p.recipe.shelfLifeHours,
      portionSize: p.recipe.portionSize,
    },
    outputQty: p.outputQty,
    portionsComputed: p.portionsComputed,
    shelfLifeHours: p.shelfLifeHours,
    useByPreview: p.useByPreview,
    today: p.today,
    locations: p.locations.map((l) => ({ id: l.id, name: l.name })),
    suggestedLocationId: p.suggestedLocationId,
    inputs: p.inputs.map((i) => ({
      ingredientId: i.ingredientId,
      name: i.name,
      baseUnit: i.baseUnit,
      isStock: i.isStock,
      proposedQty: i.proposedQty,
      units: i.units,
      suggestedLocationId: i.suggestedLocationId,
      onHand: i.onHand.map((h) => ({ locationId: h.locationId, onHandQty: h.onHandQty })),
      lots: i.lots.map((lot) => ({
        rawLotId: lot.rawLotId,
        lotCode: lot.lotCode,
        locationId: lot.locationId,
        expiry: lot.expiry,
        expiryState: lot.expiryState,
        onHandQty: lot.onHandQty,
        fefoRank: lot.fefoRank,
      })),
    })),
  });
}
