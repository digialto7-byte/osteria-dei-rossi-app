import { withApi } from "@/lib/api/with-api";
import { idParams } from "@/server/menu/schemas";
import { measured, timedJson } from "@/server/orders/timing";
import { PUSH_BODY_MAX_BYTES } from "@/server/push/constants";
import { pushMenuItem } from "@/server/push/push";
import { pushBody } from "@/server/push/schemas";

// Owner and admin only (Q158): the chef and the waiter get 403 before any RPC. A malformed id is the same 404 as a missing row.
export const POST = withApi(
  {
    roles: ["owner", "admin"],
    params: idParams,
    body: pushBody,
    maxBodyBytes: PUSH_BODY_MAX_BYTES,
  },
  async ({ supabase, params, body, timing }) => {
    const { result, header } = await measured(timing, () =>
      pushMenuItem(supabase, params.id, body),
    );
    return timedJson(result, header);
  },
);
