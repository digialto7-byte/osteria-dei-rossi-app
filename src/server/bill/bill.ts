import type { SupabaseClient } from "@supabase/supabase-js";
import { mapBillDbError } from "./errors";
import { billOutput } from "./output";

/**
 * GET /api/table-sessions/:id/bill: the bill computed by the database (lines, coperto, VAT-inclusive total, billToken), with the split
 * by covers when `parts` is given. One RPC. The reply is parsed strictly, so a cost that slipped into it is a 500, never a leak.
 */
export async function getBill(supabase: SupabaseClient, sessionId: string, parts?: number) {
  const { data, error } = await supabase.rpc("session_bill", {
    p_session: sessionId,
    p_split: parts === undefined ? null : { mode: "covers", parts },
  });
  if (error) throw mapBillDbError(error);
  return billOutput.parse(data);
}
