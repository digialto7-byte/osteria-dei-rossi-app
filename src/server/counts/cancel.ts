import type { SupabaseClient } from "@supabase/supabase-js";
import { mapCountDbError } from "./errors";
import { cancelResponse } from "./output";
import type { CancelResult } from "./types";

/** POST /api/counts/:id/cancel: abandons an open count; nothing is posted. */
export async function cancelCount(supabase: SupabaseClient, id: string): Promise<CancelResult> {
  const { data, error } = await supabase.rpc("count_cancel", { p_session: id });
  if (error) throw mapCountDbError(error);
  const r = data as CancelResult;
  return cancelResponse.parse({
    sessionId: r.sessionId,
    status: r.status,
    cancelledAt: r.cancelledAt,
  });
}
