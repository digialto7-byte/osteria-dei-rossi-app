import { withApi } from "@/lib/api/with-api";
import { parseQuery } from "@/server/counts/schemas";
import { getPendingCount } from "@/server/reservations/day";
import { noQuery } from "@/server/reservations/schemas";

// The badge of Prenotazioni is for the people who answer requests: owner and admin.
export const GET = withApi({ roles: ["owner", "admin"] }, async ({ request, supabase }) => {
  parseQuery(noQuery, new URL(request.url));
  return Response.json(await getPendingCount(supabase));
});
