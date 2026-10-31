import { withApi } from "@/lib/api/with-api";
import { parseQuery } from "@/server/counts/schemas";
import { measured, timedJson } from "@/server/orders/timing";
import { getDiscardsVsPush } from "@/server/push/discards";
import { discardsQuery } from "@/server/push/schemas";

// Owner and admin only: the chef and the waiter get 403 before any RPC.
export const GET = withApi({ roles: ["owner", "admin"] }, async ({ request, supabase, timing }) => {
  const query = parseQuery(discardsQuery, new URL(request.url));
  const { result, header } = await measured(timing, () => getDiscardsVsPush(supabase, query));
  return timedJson(result, header);
});
