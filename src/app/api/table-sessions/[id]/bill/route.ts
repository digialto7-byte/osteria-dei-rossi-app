import { withApi } from "@/lib/api/with-api";
import { getBill } from "@/server/bill/bill";
import { billQuery, idParams } from "@/server/bill/schemas";
import { parseQuery } from "@/server/counts/schemas";
import { measured, timedJson } from "@/server/orders/timing";

// Owner, admin and waiter; the chef gets 403 before any RPC. The bill is not in the service worker's cache: offline it says so.
export const GET = withApi(
  { roles: ["owner", "admin", "waiter"], params: idParams },
  async ({ request, supabase, params, timing }) => {
    const { parts } = parseQuery(billQuery, new URL(request.url));
    const { result, header } = await measured(timing, () => getBill(supabase, params.id, parts));
    return timedJson(result, header);
  },
);
