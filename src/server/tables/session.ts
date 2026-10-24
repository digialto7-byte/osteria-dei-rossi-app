import type { SupabaseClient } from "@supabase/supabase-js";
import { mapTablesDbError } from "./errors";
import { sessionResponse } from "./output";
import type { SessionPatchBody } from "./schemas";

/** PATCH /api/table-sessions/:id: change the covers or set or clear "conto richiesto". Any waiter may; the reply has the status. */
export async function updateSession(
  supabase: SupabaseClient,
  sessionId: string,
  patch: SessionPatchBody,
) {
  const { data, error } = await supabase.rpc("update_table_session", {
    p_session: sessionId,
    p_patch: patch,
  });
  if (error) throw mapTablesDbError(error);
  return sessionResponse.parse(data);
}
