import { withApi } from "@/lib/api/with-api";
import { parseQuery } from "@/server/counts/schemas";
import { createStaffReservation } from "@/server/reservations/actions";
import { MAX_RESERVATION_BODY_BYTES } from "@/server/reservations/constants";
import { getReservationsDay } from "@/server/reservations/day";
import { reservationsDayQuery, staffReservationBody } from "@/server/reservations/schemas";

// Owner, admin and waiter read the day with the customers' names and phones; the chef gets 403 before any RPC.
export const GET = withApi(
  { roles: ["owner", "admin", "waiter"] },
  async ({ request, supabase, session }) => {
    const { date } = parseQuery(reservationsDayQuery, new URL(request.url));
    return Response.json(await getReservationsDay(supabase, session.role, date));
  },
);

// A booking typed by staff, e.g. by phone: owner, admin and waiter (the chef gets 403 before any RPC). It starts accepted, with source "staff".
export const POST = withApi(
  {
    roles: ["owner", "admin", "waiter"],
    body: staffReservationBody,
    maxBodyBytes: MAX_RESERVATION_BODY_BYTES,
  },
  async ({ supabase, session, body }) =>
    Response.json(await createStaffReservation(supabase, session.role, body), { status: 201 }),
);
