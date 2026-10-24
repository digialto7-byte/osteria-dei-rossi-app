import type { SupabaseClient } from "@supabase/supabase-js";
import { mapTablesDbError } from "./errors";
import { openTableOutput } from "./output";
import type { OpenTableBody } from "./schemas";

/**
 * POST /api/tables/:id/open. The session id comes from the client, so a retry is a replay (`created: false`, 200)
 * and never a second session. Another session on an open table is a 409 table_already_open with details.session.
 */
export async function openTable(supabase: SupabaseClient, tableId: string, body: OpenTableBody) {
  const { data, error } = await supabase.rpc("open_table", {
    p_table: tableId,
    p_session: body.sessionId,
    p_covers: body.covers,
  });
  if (error) throw mapTablesDbError(error);
  return openTableOutput.parse(data);
}
