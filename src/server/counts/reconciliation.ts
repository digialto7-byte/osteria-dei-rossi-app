import type { SupabaseClient } from "@supabase/supabase-js";
import { mapCountDbError } from "./errors";
import { reconciliationResponse } from "./output";
import type { Reconciliation } from "./types";

/**
 * GET /api/reports/reconciliation: opening + receipts - consumption - waste +/- adjustments = closing, per
 * ingredient, with the latest count of the period. Quantities only. Without `to`: today's BUSINESS date, which
 * `public.business_date_of` decides in SQL because the cut-off (02:00 by default) is tenant data, so between 00:00 and
 * the cut-off the report still ends on the previous day (A5b, as `getWasteCosts` does); `from` defaults to the 1st of
 * the month of `to`. `now` is injectable for tests.
 */
export async function getReconciliation(
  supabase: SupabaseClient,
  query: { from: string | null; to: string | null; location: string | null },
  now: Date = new Date(),
): Promise<Reconciliation> {
  let to = query.to;
  if (to === null) {
    const today = await supabase.rpc("business_date_of", { p_at: now.toISOString() });
    if (today.error) throw mapCountDbError(today.error);
    to = today.data as string;
  }
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
