import type { SupabaseClient } from "@supabase/supabase-js";
import { mapOrderDbError } from "./errors";
import { fireOutput } from "./output";
import type { FireBody } from "./schemas";

/**
 * POST /api/table-sessions/:id/fire: sends the named lines to the kitchen (M19). One RPC, one transaction. A line that is
 * already fired or voided is skipped, not an error, so a replay answers 200 and writes nothing. The reply carries the lines
 * as they are now (the M18 line shape: a sale price, never a cost).
 */
export async function fireCourse(supabase: SupabaseClient, sessionId: string, body: FireBody) {
  const { data, error } = await supabase.rpc("fire_course", { p_session: sessionId, p_body: body });
  if (error) throw mapOrderDbError(error);
  return fireOutput.parse(data);
}
