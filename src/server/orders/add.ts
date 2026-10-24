import type { SupabaseClient } from "@supabase/supabase-js";
import { mapOrderDbError } from "./errors";
import { addLineOutput } from "./output";
import type { AddLineBody } from "./schemas";

/**
 * POST /api/table-sessions/:id/lines. The line id comes from the client, so a retry is a replay (`created: false`,
 * 200) and never a second line. The database checks the stock and freezes the price; the reply carries the dish's
 * remaining portions so the screen needs no second read.
 */
export async function addLine(supabase: SupabaseClient, sessionId: string, body: AddLineBody) {
  const { data, error } = await supabase.rpc("add_order_line", {
    p_session: sessionId,
    p_body: body,
  });
  if (error) throw mapOrderDbError(error);
  return addLineOutput.parse(data);
}
