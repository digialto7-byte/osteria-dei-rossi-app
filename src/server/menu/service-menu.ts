import type { SupabaseClient } from "@supabase/supabase-js";
import { mapMenuDbError } from "./errors";
import { serviceMenuOutput } from "./output";

/**
 * GET /api/menu: the menu as the waiter sells it. One shape for every role that may read it (owner, admin, waiter),
 * so a shared device's cache never holds another role's data. The database decides what is in it; the strict output
 * schema refuses any key it does not declare (a cost, say), so such a key is a 500 and never reaches the JSON.
 */
export async function getServiceMenu(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("menu_list");
  if (error) throw mapMenuDbError(error);
  return serviceMenuOutput.parse(data);
}
