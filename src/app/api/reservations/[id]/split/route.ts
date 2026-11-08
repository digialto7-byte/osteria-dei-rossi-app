import { withApi } from "@/lib/api/with-api";
import { splitReservationTables } from "@/server/reservations/actions";
import { MAX_RESERVATION_BODY_BYTES } from "@/server/reservations/constants";
import { idParams, splitBody } from "@/server/reservations/schemas";

// Owner, admin and waiter: "Separa tavoli" gives the joined tables of a seated booking back to Sala. The chef gets 403 before any RPC.
export const POST = withApi(
  {
    roles: ["owner", "admin", "waiter"],
    params: idParams,
    body: splitBody,
    maxBodyBytes: MAX_RESERVATION_BODY_BYTES,
  },
  async ({ supabase, session, params, body }) =>
    Response.json(await splitReservationTables(supabase, session.role, params.id, body)),
);
