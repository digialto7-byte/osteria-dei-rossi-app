import { withApi } from "@/lib/api/with-api";
import { discardBatch } from "@/server/batches/actions";
import { MAX_ACTION_BODY_BYTES } from "@/server/batches/constants";
import { idParams, discardBody } from "@/server/batches/schemas";

// Owner, admin and chef act on a batch; the waiter never (403 before any RPC).
export const POST = withApi(
  {
    roles: ["owner", "admin", "chef"],
    params: idParams,
    body: discardBody,
    maxBodyBytes: MAX_ACTION_BODY_BYTES,
  },
  async ({ supabase, params, body }) =>
    Response.json(await discardBatch(supabase, params.id, body), { status: 201 }),
);
