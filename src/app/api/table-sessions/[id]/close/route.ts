import { withApi } from "@/lib/api/with-api";
import { closeTable } from "@/server/bill/close";
import { MAX_CLOSE_BODY_BYTES } from "@/server/bill/constants";
import { closeBody, idParams } from "@/server/bill/schemas";
import { measured, timedJson } from "@/server/orders/timing";

// Owner, admin and waiter; the chef gets 403 before any RPC. 200 also for a replay (`changed: false`). Online only: not an outbox op.
export const POST = withApi(
  {
    roles: ["owner", "admin", "waiter"],
    params: idParams,
    body: closeBody,
    maxBodyBytes: MAX_CLOSE_BODY_BYTES,
  },
  async ({ supabase, params, body, timing }) => {
    const { result, header } = await measured(timing, () => closeTable(supabase, params.id, body));
    return timedJson(result, header);
  },
);
