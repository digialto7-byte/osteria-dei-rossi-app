import { withApi } from "@/lib/api/with-api";
import { MAX_ORDER_BODY_BYTES } from "@/server/orders/constants";
import { updateLine } from "@/server/orders/edit";
import { idParams, updateLineBody } from "@/server/orders/schemas";
import { measured, timedJson } from "@/server/orders/timing";

export const PATCH = withApi(
  {
    roles: ["owner", "admin", "waiter"],
    params: idParams,
    body: updateLineBody,
    maxBodyBytes: MAX_ORDER_BODY_BYTES,
  },
  async ({ supabase, params, body, timing }) => {
    const { result, header } = await measured(timing, () => updateLine(supabase, params.id, body));
    return timedJson(result, header);
  },
);
