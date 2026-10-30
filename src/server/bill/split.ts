import type { SupabaseClient } from "@supabase/supabase-js";
import { mapBillDbError } from "./errors";
import { billOutput } from "./output";
import type { SplitBody } from "./schemas";

/** POST /api/table-sessions/:id/bill/split: the bill with the split by items computed by the database (nothing is stored). */
export async function splitBill(supabase: SupabaseClient, sessionId: string, body: SplitBody) {
  const { data, error } = await supabase.rpc("session_bill", {
    p_session: sessionId,
    p_split: { mode: "items", ...body },
  });
  if (error) throw mapBillDbError(error);
  return billOutput.parse(data);
}
