import { withApi } from "@/lib/api/with-api";
import { parseQuery } from "@/server/counts/schemas";
import { getMonthlyPack } from "@/server/exports/monthly-pack";
import { monthlyPackQuery } from "@/server/exports/schemas";
import { measured, timedJson } from "@/server/orders/timing";

// GET /api/exports/monthly-pack?month=YYYY-MM (M24, ADR-027): the KPI, waste and actual-vs-theoretical replies of one month in a single answer, for the
// print view /report/mese. Owner and admin only: the chef and the waiter get 403 before any RPC. A static segment, so it wins over `[file]`.
export const GET = withApi({ roles: ["owner", "admin"] }, async ({ request, supabase, timing }) => {
  const query = parseQuery(monthlyPackQuery, new URL(request.url));
  const { result, header } = await measured(timing, () => getMonthlyPack(supabase, query));
  return timedJson(result, header);
});
