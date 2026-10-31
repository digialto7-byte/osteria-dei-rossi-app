import { withApi } from "@/lib/api/with-api";
import { MAX_SPLIT_BODY_BYTES } from "@/server/bill/constants";
import { idParams, splitBody } from "@/server/bill/schemas";
import { splitBill } from "@/server/bill/split";
import { measured, timedJson } from "@/server/orders/timing";

// A read with a body (a split is computed, never stored). Owner, admin and waiter; the chef gets 403 before any RPC.
export const POST = withApi(
  {
    roles: ["owner", "admin", "waiter"],
    params: idParams,
    body: splitBody,
    maxBodyBytes: MAX_SPLIT_BODY_BYTES,
  },
  async ({ supabase, params, body, timing }) => {
    const { result, header } = await measured(timing, () => splitBill(supabase, params.id, body));
    return timedJson(result, header);
  },
);
