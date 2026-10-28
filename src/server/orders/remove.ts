import type { SupabaseClient } from "@supabase/supabase-js";
import { conflictError, mapOrderDbError } from "./errors";
import { lineWriteResult } from "./output";
import type { RemoveLineBody } from "./schemas";

/** POST /api/order-lines/:id/remove: removes a draft line before it is fired (nothing is deleted; the line is voided). */
export async function removeLine(supabase: SupabaseClient, lineId: string, body: RemoveLineBody) {
  const { data, error } = await supabase.rpc("remove_order_line", { p_line: lineId, p_body: body });
  if (error) throw mapOrderDbError(error);
  const result = lineWriteResult.parse(data);
  if ("conflict" in result) throw conflictError(result.conflict);
  return result;
}
