import { withApi } from "@/lib/api/with-api";
import { parseQuery } from "@/server/counts/schemas";
import { measured, timedJson } from "@/server/orders/timing";
import { sellThroughQuery } from "@/server/push/schemas";
import { getPushSellThrough } from "@/server/push/sell-through";

// Owner, admin and chef; the waiter gets 403 before any RPC. The chef's reply carries no push price (parsed with the chef's schema).
export const GET = withApi(
  { roles: ["owner", "admin", "chef"] },
  async ({ request, supabase, session, timing }) => {
    const query = parseQuery(sellThroughQuery, new URL(request.url));
    const { result, header } = await measured(timing, () =>
      getPushSellThrough(supabase, session.role, query),
    );
    return timedJson(result, header);
  },
);
