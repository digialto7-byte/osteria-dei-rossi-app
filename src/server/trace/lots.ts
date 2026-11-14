import type { SupabaseClient } from "@supabase/supabase-js";
import { failRead, parseRead } from "./errors";
import { traceLotSearchOutput } from "./output";
import type { TraceLotsQuery } from "./schemas";

/** GET /api/trace/lots: one RPC, then the strict parse. Absent filters are null (the SQL's defaults apply). */
export async function searchLots(supabase: SupabaseClient, query: TraceLotsQuery) {
  const { data, error } = await supabase.rpc("trace_lot_search", {
    p_q: query.q ?? null,
    p_ingredient: query.ingredientId ?? null,
    p_supplier: query.supplierId ?? null,
    p_from: query.from ?? null,
    p_to: query.to ?? null,
  });
  if (error) failRead("trace_lot_search", error);
  return parseRead("trace_lot_search", traceLotSearchOutput, data);
}
