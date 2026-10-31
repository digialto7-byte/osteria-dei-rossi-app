import type { SupabaseClient } from "@supabase/supabase-js";
import { mapBillDbError } from "./errors";
import { closeOutput } from "./output";
import type { CloseBody } from "./schemas";

/**
 * POST /api/table-sessions/:id/close: closes the table in one transaction (M21 plan §3.1.3). The reply carries the closed bill, so the
 * screen needs no second read; a replay of the same close answers `changed: false`.
 */
export async function closeTable(supabase: SupabaseClient, sessionId: string, body: CloseBody) {
  const { data, error } = await supabase.rpc("close_table", { p_session: sessionId, p_body: body });
  if (error) throw mapBillDbError(error);
  return closeOutput.parse(data);
}
