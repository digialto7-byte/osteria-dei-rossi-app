import type { SupabaseClient } from "@supabase/supabase-js";
import { conflictError, mapOrderDbError } from "./errors";
import { lineWriteResult } from "./output";
import type { VoidBody } from "./schemas";

/**
 * POST /api/order-lines/:id/void: voids a line with a coded reason (M19). Before firing it changes nothing in stock; after
 * firing the portions become waste. A replay answers `changed: false`; a stale, already voided or closed-table line is a 409
 * `conflict` carrying the line as it is now.
 */
export async function voidLine(supabase: SupabaseClient, lineId: string, body: VoidBody) {
  const { data, error } = await supabase.rpc("void_line", { p_line: lineId, p_body: body });
  if (error) throw mapOrderDbError(error);
  const result = lineWriteResult.parse(data);
  if ("conflict" in result) throw conflictError(result.conflict);
  return result;
}
