import type { SupabaseClient } from "@supabase/supabase-js";
import { mapOrderDbError } from "./errors";
import { orderViewOutput } from "./output";

/** GET /api/table-sessions/:id/lines: the session and its lines (removed-before-fire lines left out). */
export async function getOrderView(supabase: SupabaseClient, sessionId: string) {
  const { data, error } = await supabase.rpc("order_view", { p_session: sessionId });
  if (error) throw mapOrderDbError(error);
  return orderViewOutput.parse(data);
}
