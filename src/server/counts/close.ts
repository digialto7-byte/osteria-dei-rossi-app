import type { SupabaseClient } from "@supabase/supabase-js";
import { mapCountDbError } from "./errors";
import { closeResponse } from "./output";
import type { CloseResult } from "./types";

/** POST /api/counts/:id/close: posts the differences and closes the count, in one transaction. No EUR. */
export async function closeCount(supabase: SupabaseClient, id: string): Promise<CloseResult> {
  const { data, error } = await supabase.rpc("count_close", { p_session: id });
  if (error) throw mapCountDbError(error);
  const r = data as CloseResult;
  return closeResponse.parse({
    sessionId: r.sessionId,
    closedAt: r.closedAt,
    linesCounted: r.linesCounted,
    linesSkipped: r.linesSkipped,
    linesWithDifference: r.linesWithDifference,
    lines: r.lines.map((l) => ({ ingredientId: l.ingredientId, differenceQty: l.differenceQty })),
  });
}
