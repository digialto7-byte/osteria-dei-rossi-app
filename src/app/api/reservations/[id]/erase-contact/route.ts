import { withApi } from "@/lib/api/with-api";
import { eraseReservationContact } from "@/server/reservations/actions";
import { MAX_RESERVATION_BODY_BYTES } from "@/server/reservations/constants";
import { emptyBody, idParams } from "@/server/reservations/schemas";

// Owner and admin only: "Cancella dati cliente" on request (GDPR erasure). The booking stays, without the customer's data.
export const POST = withApi(
  {
    roles: ["owner", "admin"],
    params: idParams,
    body: emptyBody,
    maxBodyBytes: MAX_RESERVATION_BODY_BYTES,
  },
  async ({ supabase, session, params }) =>
    Response.json(await eraseReservationContact(supabase, session.role, params.id)),
);
