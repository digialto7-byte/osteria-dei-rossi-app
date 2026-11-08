import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/errors";
import type { AppRole } from "@/lib/api/with-api";
import { t } from "@/lib/i18n";
import { openTable } from "@/server/tables/open";
import { getReservationDetail } from "./day";
import { mapReservationsDbError } from "./errors";
import { parseReply, reservationActionOutput, waiterReservationActionOutput } from "./output";
import type { SeatBody } from "./schemas";

/**
 * POST /api/reservations/:id/seat (plan §3.3.4): "Apri tavolo" on a booking. Three calls, in this order:
 *   1. reservation_detail, to know the lead table and whether the booking may be seated. This keeps a declined or not-yet-due booking from opening a table that
 *      seat_reservation would then refuse;
 *   2. open_table on the lead table with the client's session id, so a retry is a replay (`created: false`), never a second session;
 *   3. seat_reservation, which links the session to the booking (idempotent on the same session).
 * The two writes are two transactions; a retry replays both safely. A booking already seated on this very session skips step 2. The reply is `{ sessionId, created }`:
 * nothing of the customer goes back.
 */
export async function seatReservation(
  supabase: SupabaseClient,
  role: AppRole,
  reservationId: string,
  body: SeatBody,
) {
  const detail = await getReservationDetail(supabase, role, reservationId);
  const replay = detail.status === "seated" && detail.sessionId === body.sessionId;

  if (!replay && !detail.actions.includes("seat")) {
    // The database's own list says seating is not allowed now. For an accepted or arrived booking that is its business day: before it (too_early) or after it
    // (not_today). The list tells them apart: `no_show` is offered from the start instant on, which a later-day booking has not reached and an earlier-day one has.
    // Anything else is a wrong status. Nothing is opened first.
    if (detail.status === "accepted" || detail.status === "arrived") {
      throw detail.actions.includes("no_show")
        ? new ApiError(409, "not_today", t("reservationError.not_today"))
        : new ApiError(409, "too_early", t("reservationError.too_early"));
    }
    throw new ApiError(409, "status_invalid", t("reservationError.status_invalid"));
  }

  let created = false;
  if (!replay) {
    const lead = detail.leadTable?.id ?? null;
    if (lead !== null && body.tableId !== undefined && body.tableId !== lead) {
      throw new ApiError(409, "table_not_assigned", t("reservationError.table_not_assigned"));
    }
    const tableId = lead ?? body.tableId;
    if (tableId === undefined) {
      throw new ApiError(422, "table_required", t("reservationError.table_required"));
    }
    created = (
      await openTable(supabase, tableId, { sessionId: body.sessionId, covers: body.covers })
    ).created;
  }

  const { data, error } = await supabase.rpc("seat_reservation", {
    p_id: reservationId,
    p_session: body.sessionId,
  });
  if (error) throw mapReservationsDbError(error);
  parseReply(
    role === "owner" || role === "admin" ? reservationActionOutput : waiterReservationActionOutput,
    data,
  );
  return { sessionId: body.sessionId, created };
}
