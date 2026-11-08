import { withApi } from "@/lib/api/with-api";
import { moveReservation } from "@/server/reservations/actions";
import { MAX_RESERVATION_BODY_BYTES } from "@/server/reservations/constants";
import { idParams, moveBody } from "@/server/reservations/schemas";

// Owner and admin only: a new slot and party; the tables are released and the reply carries a fresh suggestion.
export const POST = withApi(
  {
    roles: ["owner", "admin"],
    params: idParams,
    body: moveBody,
    maxBodyBytes: MAX_RESERVATION_BODY_BYTES,
  },
  async ({ supabase, session, params, body }) =>
    Response.json(await moveReservation(supabase, session.role, params.id, body)),
);
