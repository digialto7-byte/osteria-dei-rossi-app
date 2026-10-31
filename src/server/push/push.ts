import type { SupabaseClient } from "@supabase/supabase-js";
import { mapPushDbError } from "./errors";
import { pushResultOutput } from "./output";
import type { PushBody } from "./schemas";

/**
 * POST /api/menu/:id/push: start (with an optional temporary price) or stop. One RPC, which is one transaction (the item's columns and the log
 * row); this only passes the body and parses the answer. An identical repeat answers `changed: false` and writes nothing.
 */
export async function pushMenuItem(supabase: SupabaseClient, itemId: string, body: PushBody) {
  const { data, error } = await supabase.rpc("push_menu_item", { p_item: itemId, p_body: body });
  if (error) throw mapPushDbError(error);
  return pushResultOutput.parse(data);
}
