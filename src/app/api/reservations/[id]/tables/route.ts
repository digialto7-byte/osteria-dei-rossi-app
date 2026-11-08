import { withApi } from "@/lib/api/with-api";
import { assignReservationTables } from "@/server/reservations/actions";
import { MAX_RESERVATION_BODY_BYTES } from "@/server/reservations/constants";
import { idParams, tablePickBody } from "@/server/reservations/schemas";

// Owner and admin only: assign again on an accepted or arrived booking.
export const POST = withApi(
  {
    roles: ["owner", "admin"],
    params: idParams,
    body: tablePickBody,
    maxBodyBytes: MAX_RESERVATION_BODY_BYTES,
  },
  async ({ supabase, session, params, body }) =>
    Response.json(await assignReservationTables(supabase, session.role, params.id, body)),
);
