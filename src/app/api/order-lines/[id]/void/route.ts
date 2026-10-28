import { withApi } from "@/lib/api/with-api";
import { MAX_ORDER_BODY_BYTES } from "@/server/orders/constants";
import { idParams, voidBody } from "@/server/orders/schemas";
import { measured, timedJson } from "@/server/orders/timing";
import { voidLine } from "@/server/orders/void";

export const POST = withApi(
  {
    roles: ["owner", "admin", "waiter"],
    params: idParams,
    body: voidBody,
    maxBodyBytes: MAX_ORDER_BODY_BYTES,
  },
  async ({ supabase, params, body, timing }) => {
    const { result, header } = await measured(timing, () => voidLine(supabase, params.id, body));
    return timedJson(result, header);
  },
);
