import { ApiError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/with-api";
import { dashboardSummary } from "@/server/dashboard/summary";
import { measured, timedJson } from "@/server/orders/timing";

// The owner's and the admin's Oggi, in one round trip: the chef and the waiter get a 403 before any query. The function
// behind it is SECURITY DEFINER and checks the role again. No parameters: a query string is a 400.
export const GET = withApi(
  { roles: ["owner", "admin"] },
  async ({ request, supabase, session, timing }) => {
    if ([...new URL(request.url).searchParams.keys()].length > 0) {
      throw new ApiError(400, "invalid_request", "Filtri non validi.");
    }
    const { result, header } = await measured(timing, () =>
      dashboardSummary(supabase, session.role),
    );
    return timedJson(result, header);
  },
);
