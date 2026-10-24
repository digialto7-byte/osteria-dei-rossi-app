import type { SupabaseClient } from "@supabase/supabase-js";
import { venueDate } from "@/lib/time/venue-date";
import { mapCountDbError } from "./errors";
import { reconciliationResponse } from "./output";
import type { Reconciliation } from "./types";

/**
 * GET /api/reports/reconciliation: opening + receipts - consumption - waste +/- adjustments = closing, per
 * ingredient, with the latest count of the period. Quantities only. Without dates: the Rome month so far (`now` is
 * injectable for tests); with only `to`, the month of `to` starts the period.
 */
export async function getReconciliation(
  supabase: SupabaseClient,
  query: { from: string | null; to: string | null; location: string | null },
  now: Date = new Date(),
): Promise<Reconciliation> {
  const to = query.to ?? venueDate(now);
  const from = query.from ?? `${to.slice(0, 8)}01`;
  const { data, error } = await supabase.rpc("stock_reconciliation", {
    p_from: from,
    p_to: to,
    p_location: query.location,
  });
  if (error) throw mapCountDbError(error);
  const r = data as Reconciliation;
  return reconciliationResponse.parse({
    from: r.from,
    to: r.to,
    location: { id: r.location.id, name: r.location.name },
    items: r.items.map((i) => ({
      ingredientId: i.ingredientId,
      name: i.name,
      baseUnit: i.baseUnit,
      openingQty: i.openingQty,
      receiptsQty: i.receiptsQty,
      consumptionQty: i.consumptionQty,
      wasteQty: i.wasteQty,
      transfersInQty: i.transfersInQty,
      transfersOutQty: i.transfersOutQty,
      countAdjustmentsQty: i.countAdjustmentsQty,
      otherQty: i.otherQty,
      closingQty: i.closingQty,
      balanced: i.balanced,
      countedQty: i.countedQty,
      countedAt: i.countedAt,
      countSessionId: i.countSessionId,
      afterCountQty: i.afterCountQty,
      matchesCount: i.matchesCount,
    })),
  });
}
