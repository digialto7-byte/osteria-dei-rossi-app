import { withApi } from "@/lib/api/with-api";
import { MAX_ORDER_BODY_BYTES } from "@/server/orders/constants";
import { removeLine } from "@/server/orders/remove";
import { idParams, removeLineBody } from "@/server/orders/schemas";
import { measured, timedJson } from "@/server/orders/timing";

export const POST = withApi(
  {
    roles: ["owner", "admin", "waiter"],
    params: idParams,
    body: removeLineBody,
    maxBodyBytes: MAX_ORDER_BODY_BYTES,
  },
  async ({ supabase, params, body, timing }) => {
    const { result, header } = await measured(timing, () => removeLine(supabase, params.id, body));
    return timedJson(result, header);
  },
);
