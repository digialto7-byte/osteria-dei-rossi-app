import { ApiError } from "@/lib/api/errors";
import { t } from "@/lib/i18n";
import { withApi } from "@/lib/api/with-api";
import { measured, timedJson } from "@/server/orders/timing";
import { applyOps } from "@/server/sync/apply";
import { MAX_SYNC_BODY_BYTES, SYNC_VERSION_HEADER, syncVersionOf } from "@/server/sync/constants";
import { syncBody } from "@/server/sync/schemas";

// Owner, admin and waiter (the table operators); the chef gets 403 before any RPC. One apply_op RPC per op, in order (ADR-022).
// Comanda per uscita: X-Sync-Version names the shape the bundle parses; none is version 1 (an old bundle), down-shaped (plan §3.12).
export const POST = withApi(
  { roles: ["owner", "admin", "waiter"], body: syncBody, maxBodyBytes: MAX_SYNC_BODY_BYTES },
  async ({ supabase, body, request, timing }) => {
    const version = syncVersionOf(request.headers.get(SYNC_VERSION_HEADER));
    if (version === null)
      throw new ApiError(400, "invalid_request", t("syncError.invalid_request"));
    const { result, header } = await measured(timing, () => applyOps(supabase, body.ops, version));
    return timedJson(result, header);
  },
);
