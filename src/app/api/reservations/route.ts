import { withApi } from "@/lib/api/with-api";
import { parseQuery } from "@/server/counts/schemas";
import { getReservationsDay } from "@/server/reservations/day";
import { reservationsDayQuery } from "@/server/reservations/schemas";

// Owner, admin and waiter read the day with the customers' names and phones; the chef gets 403 before any RPC.
export const GET = withApi(
  { roles: ["owner", "admin", "waiter"] },
  async ({ request, supabase, session }) => {
    const { date } = parseQuery(reservationsDayQuery, new URL(request.url));
    return Response.json(await getReservationsDay(supabase, session.role, date));
  },
);
