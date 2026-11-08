import { withApi } from "@/lib/api/with-api";
import { declineReservation } from "@/server/reservations/actions";
import { MAX_RESERVATION_BODY_BYTES } from "@/server/reservations/constants";
import { idParams, declineBody } from "@/server/reservations/schemas";

// Owner and admin only (declining after accepting sends the declined e-mail).
export const POST = withApi(
  {
    roles: ["owner", "admin"],
    params: idParams,
    body: declineBody,
    maxBodyBytes: MAX_RESERVATION_BODY_BYTES,
  },
  async ({ supabase, session, params, body }) =>
    Response.json(await declineReservation(supabase, session.role, params.id, body)),
);
