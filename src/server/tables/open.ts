import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { alreadyOpenError, alreadyOpenSessionId, mapTablesDbError } from "./errors";
import { openTableOutput, sessionOutput } from "./output";
import type { OpenTableBody } from "./schemas";

/**
 * POST /api/tables/:id/open. The session id comes from the client, so a retry is a replay (`created: false`, 200)
 * and never a second session. Another session on an open table is a 409 table_already_open with details.session
 * (the error carries the session id only; the shape is read with table_session_get).
 */
export async function openTable(supabase: SupabaseClient, tableId: string, body: OpenTableBody) {
  const { data, error } = await supabase.rpc("open_table", {
    p_table: tableId,
    p_session: body.sessionId,
    p_covers: body.covers,
  });
  if (error) {
    if (error.code === "P0001" && error.message === "table_already_open") {
      throw alreadyOpenError(await openSessionOf(supabase, alreadyOpenSessionId(error.details)));
    }
    throw mapTablesDbError(error);
  }
  return openTableOutput.parse(data);
}

/**
 * The open session named by the error, in the public session shape. The error carries the id only (no personal data in
 * the Postgres log); the shape comes from table_session_get. Any failure leaves the plain 409 without details.
 */
async function openSessionOf(supabase: SupabaseClient, id: string | undefined) {
  if (!id) return undefined;
  const { data, error } = await supabase.rpc("table_session_get", { p_session: id });
  if (error) return undefined;
  const parsed = z.strictObject({ session: sessionOutput }).safeParse(data);
  return parsed.success ? parsed.data.session : undefined;
}
