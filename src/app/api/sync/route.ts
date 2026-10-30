import { withApi } from "@/lib/api/with-api";
import { measured, timedJson } from "@/server/orders/timing";
import { applyOps } from "@/server/sync/apply";
import { MAX_SYNC_BODY_BYTES } from "@/server/sync/constants";
import { syncBody } from "@/server/sync/schemas";

// Owner, admin and waiter (the table operators); the chef gets 403 before any RPC. One apply_op RPC per op, in order (ADR-022).
export const POST = withApi(
  { roles: ["owner", "admin", "waiter"], body: syncBody, maxBodyBytes: MAX_SYNC_BODY_BYTES },
  async ({ supabase, body, timing }) => {
    const { result, header } = await measured(timing, () => applyOps(supabase, body.ops));
    return timedJson(result, header);
  },
);
