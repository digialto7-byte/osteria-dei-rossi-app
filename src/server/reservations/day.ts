import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppRole } from "@/lib/api/with-api";
import { mapReservationsDbError } from "./errors";
import {
  parseReply,
  pendingCountOutput,
  reservationDetailOutput,
  reservationsDayOutput,
  waiterReservationDetailOutput,
  waiterReservationsDayOutput,
} from "./output";

// Owner and admin read the booking with `emailStatus` (and the suggestion on the detail); the waiter's reply has neither. The role is the session's, so the
// schema that checks the reply is the one of the role: a key the role must not see is a parse error, never a field on a screen.
const seesEmailStatus = (role: AppRole): boolean => role === "owner" || role === "admin";

/** GET /api/reservations?date=: one business day by service with its bookings. No date is today's business date (the database's rule). */
export async function getReservationsDay(supabase: SupabaseClient, role: AppRole, date?: string) {
  const { data, error } = await supabase.rpc("reservations_day", { p_date: date ?? null });
  if (error) throw mapReservationsDbError(error);
  return parseReply(
    seesEmailStatus(role) ? reservationsDayOutput : waiterReservationsDayOutput,
    data,
  );
}

/** GET /api/reservations/:id: one booking with its events and, for owner and admin on a pending or accepted one, the table suggestion. */
export async function getReservationDetail(supabase: SupabaseClient, role: AppRole, id: string) {
  const { data, error } = await supabase.rpc("reservation_detail", { p_id: id });
  if (error) throw mapReservationsDbError(error);
  return parseReply(
    seesEmailStatus(role) ? reservationDetailOutput : waiterReservationDetailOutput,
    data,
  );
}

/** GET /api/reservations/pending-count: the requests still to answer (the badge of Prenotazioni). */
export async function getPendingCount(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("reservations_pending_count");
  if (error) throw mapReservationsDbError(error);
  return parseReply(pendingCountOutput, data);
}
