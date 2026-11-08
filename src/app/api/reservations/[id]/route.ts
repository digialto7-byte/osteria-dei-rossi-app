import { withApi } from "@/lib/api/with-api";
import { getReservationDetail } from "@/server/reservations/day";
import { idParams } from "@/server/reservations/schemas";

// A malformed id is a 404 before any RPC (withApi); another tenant's id is the database's P0002.
export const GET = withApi(
  { roles: ["owner", "admin", "waiter"], params: idParams },
  async ({ supabase, session, params }) =>
    Response.json(await getReservationDetail(supabase, session.role, params.id)),
);
