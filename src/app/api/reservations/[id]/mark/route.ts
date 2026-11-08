import { withApi } from "@/lib/api/with-api";
import { markReservation } from "@/server/reservations/actions";
import { MAX_RESERVATION_BODY_BYTES } from "@/server/reservations/constants";
import { idParams, markBody } from "@/server/reservations/schemas";

// Owner, admin and waiter mark a booking arrived or no-show; the chef gets 403 before any RPC.
export const POST = withApi(
  {
    roles: ["owner", "admin", "waiter"],
    params: idParams,
    body: markBody,
    maxBodyBytes: MAX_RESERVATION_BODY_BYTES,
  },
  async ({ supabase, session, params, body }) =>
    Response.json(await markReservation(supabase, session.role, params.id, body)),
);
