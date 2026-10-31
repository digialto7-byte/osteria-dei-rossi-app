import { withApi } from "@/lib/api/with-api";
import { parseQuery } from "@/server/counts/schemas";
import { measured, timedJson } from "@/server/orders/timing";
import { unmappedQuery } from "@/server/reports/schemas";
import { getUnmappedItems } from "@/server/reports/unmapped";

// Owner and admin only: the chef and the waiter get 403 before any RPC.
export const GET = withApi({ roles: ["owner", "admin"] }, async ({ request, supabase, timing }) => {
  const query = parseQuery(unmappedQuery, new URL(request.url));
  const { result, header } = await measured(timing, () => getUnmappedItems(supabase, query));
  return timedJson(result, header);
});
