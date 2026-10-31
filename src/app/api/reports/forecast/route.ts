import { withApi } from "@/lib/api/with-api";
import { parseQuery } from "@/server/counts/schemas";
import { measured, timedJson } from "@/server/orders/timing";
import { getForecast } from "@/server/push/forecast";
import { forecastQuery } from "@/server/push/schemas";

// Owner, admin and chef; the waiter gets 403 before any RPC. The chef's reply has no covers (parsed with the chef's schema).
export const GET = withApi(
  { roles: ["owner", "admin", "chef"] },
  async ({ request, supabase, session, timing }) => {
    const query = parseQuery(forecastQuery, new URL(request.url));
    const { result, header } = await measured(timing, () =>
      getForecast(supabase, session.role, query),
    );
    return timedJson(result, header);
  },
);
