import { withApi } from "@/lib/api/with-api";
import { MAX_RESERVATION_BODY_BYTES } from "@/server/reservations/constants";
import { idParams, seatBody } from "@/server/reservations/schemas";
import { seatReservation } from "@/server/reservations/seat";

// Owner, admin and waiter. 200 for both a new session and a replay (`created` says which).
export const POST = withApi(
  {
    roles: ["owner", "admin", "waiter"],
    params: idParams,
    body: seatBody,
    maxBodyBytes: MAX_RESERVATION_BODY_BYTES,
  },
  async ({ supabase, session, params, body }) =>
    Response.json(await seatReservation(supabase, session.role, params.id, body)),
);
