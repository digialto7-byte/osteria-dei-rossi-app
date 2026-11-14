import type { SupabaseClient } from "@supabase/supabase-js";
import { mapReservationsDbError } from "./errors";
import { parseReply, reservationsCoversOutput } from "./output";

/**
 * GET /api/reservations/covers?date=: the confirmed bookings and covers per service, as numbers only (the chef may call it; the database gives the chef
 * counts and no row). No date is today's business date. The same strict schema serves every role: there is nothing to hide, because there is nothing else.
 */
export async function getReservationsCovers(supabase: SupabaseClient, date?: string) {
  const { data, error } = await supabase.rpc("reservations_covers", { p_date: date ?? null });
  if (error) throw mapReservationsDbError(error);
  return parseReply(reservationsCoversOutput, data);
}
