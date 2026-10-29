import { withApi } from "@/lib/api/with-api";
import { offlineCacheable } from "@/lib/api/offline-cache";
import { addLine } from "@/server/orders/add";
import { MAX_ORDER_BODY_BYTES } from "@/server/orders/constants";
import { addLineBody, idParams } from "@/server/orders/schemas";
import { measured, timedJson } from "@/server/orders/timing";
import { getOrderView } from "@/server/orders/view";

// Owner, admin and waiter; the chef gets 403 before any RPC (kitchen tickets are M19). Server-Timing for AT7.
const roles = ["owner", "admin", "waiter"] as const;

export const GET = withApi({ roles, params: idParams }, async ({ supabase, params, timing }) => {
  const { result, header } = await measured(timing, () => getOrderView(supabase, params.id));
  return offlineCacheable(timedJson(result, header));
});

// 201 for a new line, 200 for a replay of the same line id (idempotent, M20).
export const POST = withApi(
  { roles, params: idParams, body: addLineBody, maxBodyBytes: MAX_ORDER_BODY_BYTES },
  async ({ supabase, params, body, timing }) => {
    const { result, header } = await measured(timing, () => addLine(supabase, params.id, body));
    return timedJson(result, header, result.created ? 201 : 200);
  },
);
