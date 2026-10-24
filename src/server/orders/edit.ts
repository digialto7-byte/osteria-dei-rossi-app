import type { SupabaseClient } from "@supabase/supabase-js";
import { mapOrderDbError } from "./errors";
import { lineWriteOutput } from "./output";
import type { UpdateLineBody } from "./schemas";

/** PATCH /api/order-lines/:id: edit or move a draft line. Last write wins; a loser gets a 409 conflict with the current line. */
export async function updateLine(supabase: SupabaseClient, lineId: string, patch: UpdateLineBody) {
  const { data, error } = await supabase.rpc("update_order_line", {
    p_line: lineId,
    p_patch: patch,
  });
  if (error) throw mapOrderDbError(error);
  return lineWriteOutput.parse(data);
}
