import { withApi } from "@/lib/api/with-api";
import { parseQuery } from "@/server/counts/schemas";
import { measured, timedJson } from "@/server/orders/timing";
import { getPushList } from "@/server/push/list";
import { pushListQuery } from "@/server/push/schemas";

// Owner, admin and chef; the waiter gets 403 before any RPC. The chef's reply carries no euro and no price (parsed with the chef's schema).
export const GET = withApi(
  { roles: ["owner", "admin", "chef"] },
  async ({ request, supabase, session, timing }) => {
    parseQuery(pushListQuery, new URL(request.url));
    const { result, header } = await measured(timing, () => getPushList(supabase, session.role));
    return timedJson(result, header);
  },
);
