import { withApi } from "@/lib/api/with-api";
import { parseQuery } from "@/server/counts/schemas";
import { measured, timedJson } from "@/server/orders/timing";
import { periodQuery } from "@/server/reports/schemas";
import { getServicesReport } from "@/server/services/report";

// Owner and admin only: the chef and the waiter get 403 before any RPC (project V6: the chef sees no euro). The query is the KPI report's own
// periodQuery, so the two reads of the Andamento view take the same parameters. The function behind it is SECURITY DEFINER and checks the role again.
export const GET = withApi({ roles: ["owner", "admin"] }, async ({ request, supabase, timing }) => {
  const query = parseQuery(periodQuery, new URL(request.url));
  const { result, header } = await measured(timing, () => getServicesReport(supabase, query));
  return timedJson(result, header);
});
