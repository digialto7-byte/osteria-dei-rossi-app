import type { SupabaseClient } from "@supabase/supabase-js";
import { BATCH_LIST_PAGE_SIZE } from "./constants";
import { mapBatchDbError } from "./errors";
import { batchListResponse, batchListWithCostResponse } from "./output";
import type { BatchCursor } from "./schemas";
import type { BatchCost, BatchCostRow, BatchItem, BatchListResult } from "./types";

const itemOf = (b: BatchItem) => ({
  batchId: b.batchId,
  lotCode: b.lotCode,
  recipeKey: b.recipeKey,
  recipeName: b.recipeName,
  version: b.version,
  producedAt: b.producedAt,
  useBy: b.useBy,
  useByState: b.useByState,
  shelfLifeHours: b.shelfLifeHours,
  outputQty: b.outputQty,
  outputUnit: b.outputUnit,
  portionsComputed: b.portionsComputed,
  portionsInitial: b.portionsInitial,
  portionsRemaining: b.portionsRemaining,
  state: b.state,
  locationId: b.locationId,
  locationName: b.locationName,
  byInitials: b.byInitials,
  byMe: b.byMe,
});

/**
 * GET /api/batches: the batches, newest first, as quantities (public.batch_list). Only when the caller may read costs
 * (owner, admin) does a second call, public.batch_costs, add the frozen cost of the page's batches; the chef's path
 * never calls it and his answer has no cost key at all (founder Q16 = project V6).
 */
export async function listBatches(
  supabase: SupabaseClient,
  query: { recipeKey: string | null; before: BatchCursor | null },
  withCosts: boolean,
) {
  const { data, error } = await supabase.rpc("batch_list", {
    p_recipe_key: query.recipeKey,
    p_before_at: query.before?.producedAt ?? null,
    p_before_id: query.before?.id ?? null,
    p_limit: BATCH_LIST_PAGE_SIZE,
  });
  if (error) throw mapBatchDbError(error);
  const page = data as BatchListResult;
  const nextCursor = page.nextCursor ? `${page.nextCursor.producedAt}_${page.nextCursor.id}` : null;
  const items = page.items.map(itemOf);
  if (!withCosts) return batchListResponse.parse({ items, nextCursor });

  const costs = new Map<string, BatchCost>();
  if (items.length > 0) {
    const result = await supabase.rpc("batch_costs", { p_batch_ids: items.map((i) => i.batchId) });
    if (result.error) throw mapBatchDbError(result.error);
    for (const row of (result.data ?? []) as BatchCostRow[]) {
      costs.set(row.batch_id, {
        totalEur: row.total_cost_eur,
        perPortionEur: row.unit_cost_eur,
        incomplete: row.incomplete,
      });
    }
  }
  // A batch without a cost row (it should not happen) is shown as incomplete, never as 0.
  const unknown: BatchCost = { totalEur: null, perPortionEur: null, incomplete: true };
  return batchListWithCostResponse.parse({
    items: items.map((item) => ({ ...item, cost: costs.get(item.batchId) ?? unknown })),
    nextCursor,
  });
}
