import { withApi } from "@/lib/api/with-api";
import { acceptReservation } from "@/server/reservations/actions";
import { MAX_RESERVATION_BODY_BYTES } from "@/server/reservations/constants";
import { idParams, tablePickBody } from "@/server/reservations/schemas";

// Owner and admin only: the waiter and the chef get 403 before any RPC (Q-R1: waiters do not accept or decline).
export const POST = withApi(
  {
    roles: ["owner", "admin"],
    params: idParams,
    body: tablePickBody,
    maxBodyBytes: MAX_RESERVATION_BODY_BYTES,
  },
  async ({ supabase, session, params, body }) =>
    Response.json(await acceptReservation(supabase, session.role, params.id, body)),
);
