import type { SupabaseClient } from "@supabase/supabase-js";
import { mapKitchenDbError } from "./errors";
import { kitchenTicketsOutput } from "./output";

/** GET /api/kitchen/tickets: today's sent dishes of open tables, oldest first, no euro value (M19 plan §3.1.8). */
export async function getKitchenTickets(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("kitchen_tickets");
  if (error) throw mapKitchenDbError(error);
  return kitchenTicketsOutput.parse(data);
}
