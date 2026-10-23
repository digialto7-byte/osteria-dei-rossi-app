import { withApi } from "@/lib/api/with-api";
import { cancelCount } from "@/server/counts/cancel";
import { MAX_COUNT_BODY_BYTES } from "@/server/counts/constants";
import { cancelBody, idParams } from "@/server/counts/schemas";

export const POST = withApi(
  {
    roles: ["owner", "admin", "chef"],
    params: idParams,
    body: cancelBody,
    maxBodyBytes: MAX_COUNT_BODY_BYTES,
  },
  async ({ supabase, params }) => Response.json(await cancelCount(supabase, params.id)),
);
