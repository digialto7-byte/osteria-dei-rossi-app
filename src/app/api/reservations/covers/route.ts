import { withApi } from "@/lib/api/with-api";
import { parseQuery } from "@/server/counts/schemas";
import { getReservationsCovers } from "@/server/reservations/covers";
import { coversQuery } from "@/server/reservations/schemas";

// Owner, admin, waiter and chef: counts only, never a name, a phone or an e-mail (D9). Not offline-cached.
export const GET = withApi(
  { roles: ["owner", "admin", "waiter", "chef"] },
  async ({ request, supabase }) => {
    const { date } = parseQuery(coversQuery, new URL(request.url));
    return Response.json(await getReservationsCovers(supabase, date));
  },
);
