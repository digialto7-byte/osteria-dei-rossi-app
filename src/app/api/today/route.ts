import { ApiError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/with-api";
import { todaySummary } from "@/server/today/summary";

// Counts for "Oggi": owner, admin and chef; the waiter is sent to the tables and gets a 403 before any query. The
// function behind it is SECURITY INVOKER, so RLS applies as well. No parameters: a query string is a 400.
export const GET = withApi(
  { roles: ["owner", "admin", "chef"] },
  async ({ request, supabase, session }) => {
    if ([...new URL(request.url).searchParams.keys()].length > 0) {
      throw new ApiError(400, "invalid_request", "Filtri non validi.");
    }
    return Response.json(await todaySummary(supabase, session.role));
  },
);
