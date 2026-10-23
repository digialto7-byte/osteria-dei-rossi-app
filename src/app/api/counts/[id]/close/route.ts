import { withApi } from "@/lib/api/with-api";
import { closeCount } from "@/server/counts/close";
import { MAX_COUNT_BODY_BYTES } from "@/server/counts/constants";
import { closeBody, idParams } from "@/server/counts/schemas";

export const POST = withApi(
  {
    roles: ["owner", "admin", "chef"],
    params: idParams,
    body: closeBody,
    maxBodyBytes: MAX_COUNT_BODY_BYTES,
  },
  async ({ supabase, params }) => Response.json(await closeCount(supabase, params.id)),
);
