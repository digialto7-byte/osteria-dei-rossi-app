import { withApi } from "@/lib/api/with-api";
import { idParams } from "@/server/bill/schemas";
import { measured, timedJson } from "@/server/orders/timing";
import { MAX_SESSION_SERVICE_BODY_BYTES } from "@/server/services/constants";
import { setSessionService } from "@/server/services/override";
import { sessionServiceBody } from "@/server/services/schemas";

// Owner and admin only: the waiter and the chef get 403 before any RPC. 200 also for a request equal to the current state (`changed: false`).
// Online only: not an outbox op.
export const POST = withApi(
  {
    roles: ["owner", "admin"],
    params: idParams,
    body: sessionServiceBody,
    maxBodyBytes: MAX_SESSION_SERVICE_BODY_BYTES,
  },
  async ({ supabase, params, body, timing }) => {
    const { result, header } = await measured(timing, () =>
      setSessionService(supabase, params.id, body),
    );
    return timedJson(result, header);
  },
);
