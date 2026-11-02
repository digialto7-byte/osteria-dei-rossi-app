import type { SupabaseClient } from "@supabase/supabase-js";
import { mapServicesDbError } from "./errors";
import { sessionServiceOutput } from "./output";
import type { SessionServiceBody } from "./schemas";

/**
 * POST /api/table-sessions/:id/service: moves one table to another service, or back to automatic (null). Each move is an appended row; the last one
 * wins. Owner and admin only, until the day is final (cut-off plus 10 minutes). An identical request answers `changed: false`.
 */
export async function setSessionService(
  supabase: SupabaseClient,
  sessionId: string,
  body: SessionServiceBody,
) {
  const { data, error } = await supabase.rpc("set_session_service", {
    p_session: sessionId,
    p_body: body,
  });
  if (error) throw mapServicesDbError(error);
  return sessionServiceOutput.parse(data);
}
