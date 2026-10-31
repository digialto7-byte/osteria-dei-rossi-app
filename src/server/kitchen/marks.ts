import type { SupabaseClient } from "@supabase/supabase-js";
import { mapKitchenDbError } from "./errors";
import { markLineOutput, markTicketOutput } from "./output";
import type { MarkLineBody, MarkTicketBody } from "./schemas";

/**
 * POST /api/kitchen/lines/:id/mark: sets a fired dish to done or not done (M19b). The body carries the state wanted, so a double
 * tap or a retry changes nothing the second time. The reply carries the whole board, read after the write.
 */
export async function markKitchenLine(
  supabase: SupabaseClient,
  lineId: string,
  body: MarkLineBody,
) {
  const { data, error } = await supabase.rpc("kitchen_mark_line", { p_line: lineId, p_body: body });
  if (error) throw mapKitchenDbError(error);
  return markLineOutput.parse(data);
}

/** POST /api/kitchen/tickets/mark: closes or reopens a comanda by hand (M19b). Idempotent like the line mark. */
export async function markKitchenTicket(supabase: SupabaseClient, body: MarkTicketBody) {
  const { data, error } = await supabase.rpc("kitchen_set_ticket", { p_body: body });
  if (error) throw mapKitchenDbError(error);
  return markTicketOutput.parse(data);
}
