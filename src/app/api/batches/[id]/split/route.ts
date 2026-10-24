import { withApi } from "@/lib/api/with-api";
import { splitBatch } from "@/server/batches/actions";
import { MAX_ACTION_BODY_BYTES } from "@/server/batches/constants";
import { idParams, splitBody } from "@/server/batches/schemas";

// Owner, admin and chef act on a batch; the waiter never (403 before any RPC).
export const POST = withApi(
  {
    roles: ["owner", "admin", "chef"],
    params: idParams,
    body: splitBody,
    maxBodyBytes: MAX_ACTION_BODY_BYTES,
  },
  async ({ supabase, params, body }) =>
    Response.json(await splitBatch(supabase, params.id, body), { status: 201 }),
);
