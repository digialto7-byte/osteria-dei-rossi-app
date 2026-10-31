import { withApi } from "@/lib/api/with-api";
import { parseQuery } from "@/server/counts/schemas";
import { measured, timedJson } from "@/server/orders/timing";
import { getKpiReport } from "@/server/reports/kpis";
import { periodQuery } from "@/server/reports/schemas";

// Owner and admin only: the chef and the waiter get 403 before any RPC (project V6: the chef sees no euro). The function behind it is
// SECURITY DEFINER and checks the role again.
export const GET = withApi({ roles: ["owner", "admin"] }, async ({ request, supabase, timing }) => {
  const query = parseQuery(periodQuery, new URL(request.url));
  const { result, header } = await measured(timing, () => getKpiReport(supabase, query));
  return timedJson(result, header);
});
