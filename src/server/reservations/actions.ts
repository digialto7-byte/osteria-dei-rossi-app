import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppRole } from "@/lib/api/with-api";
import { mapReservationsDbError } from "./errors";
import { parseReply, reservationActionOutput, waiterReservationActionOutput } from "./output";
import type {
  DeclineBody,
  MarkBody,
  MoveBody,
  SplitBody,
  StaffReservationBody,
  TablePickBody,
} from "./schemas";

// Every action returns the detail of the booking plus `changed`. The reply is parsed by the schema of the caller's role (the waiter's has no emailStatus), so a
// key the role must not see is a parse error and never a field on a screen.
const replySchema = (role: AppRole) =>
  role === "owner" || role === "admin" ? reservationActionOutput : waiterReservationActionOutput;

async function run(
  supabase: SupabaseClient,
  role: AppRole,
  fn: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw mapReservationsDbError(error);
  return parseReply(replySchema(role), data);
}

/** POST /api/reservations/:id/accept: pending to accepted, with tables, a group or none. */
export const acceptReservation = (
  supabase: SupabaseClient,
  role: AppRole,
  id: string,
  body: TablePickBody,
) => run(supabase, role, "accept_reservation", { p_id: id, p_body: body });

/** POST /api/reservations/:id/decline. */
export const declineReservation = (
  supabase: SupabaseClient,
  role: AppRole,
  id: string,
  body: DeclineBody,
) => run(supabase, role, "decline_reservation", { p_id: id, p_body: body });

/** POST /api/reservations/:id/move: a new date, time, service and party; the tables are released. */
export const moveReservation = (
  supabase: SupabaseClient,
  role: AppRole,
  id: string,
  body: MoveBody,
) => run(supabase, role, "move_reservation", { p_id: id, p_body: body });

/** POST /api/reservations/:id/tables: assign again (accepted or arrived). */
export const assignReservationTables = (
  supabase: SupabaseClient,
  role: AppRole,
  id: string,
  body: TablePickBody,
) => run(supabase, role, "assign_reservation_tables", { p_id: id, p_body: body });

/** POST /api/reservations/:id/mark: arrived or no-show (waiters too). */
export const markReservation = (
  supabase: SupabaseClient,
  role: AppRole,
  id: string,
  body: MarkBody,
) => run(supabase, role, "mark_reservation", { p_id: id, p_body: body });

/** POST /api/reservations/:id/erase-contact: the customer's data goes, the booking stays. */
export const eraseReservationContact = (supabase: SupabaseClient, role: AppRole, id: string) =>
  run(supabase, role, "erase_reservation_contact", { p_id: id });

/** POST /api/reservations/:id/split: give tables of a seated combined booking back to Sala (waiters too). No tableIds means every table but the lead. */
export const splitReservationTables = (
  supabase: SupabaseClient,
  role: AppRole,
  id: string,
  body: SplitBody,
) =>
  run(supabase, role, "split_reservation_tables", {
    p_reservation: id,
    p_tables: body.tableIds ?? null,
  });

/** POST /api/reservations: a booking typed by staff (owner, admin and waiter). It starts accepted. */
export const createStaffReservation = (
  supabase: SupabaseClient,
  role: AppRole,
  body: StaffReservationBody,
) => run(supabase, role, "create_staff_reservation", { p_body: body });
