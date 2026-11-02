import { withApi } from "@/lib/api/with-api";
import { parseQuery } from "@/server/counts/schemas";
import { measured, timedJson } from "@/server/orders/timing";
import { getDayServices } from "@/server/services/day";
import { dayServicesQuery } from "@/server/services/schemas";

// Owner and admin only (the day close holds the frozen totals); the waiter and the chef get 403 before any RPC.
export const GET = withApi({ roles: ["owner", "admin"] }, async ({ request, supabase, timing }) => {
  const { date } = parseQuery(dayServicesQuery, new URL(request.url));
  const { result, header } = await measured(timing, () => getDayServices(supabase, date));
  return timedJson(result, header);
});
