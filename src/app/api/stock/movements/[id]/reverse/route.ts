import { withApi } from "@/lib/api/with-api";
import { MAX_STOCK_BODY_BYTES } from "@/server/stock/constants";
import { reverseMovement } from "@/server/stock/reverse";
import { idParams, reverseBody } from "@/server/stock/schemas";

export const POST = withApi(
  {
    roles: ["owner", "admin", "chef"],
    params: idParams,
    body: reverseBody,
    maxBodyBytes: MAX_STOCK_BODY_BYTES,
  },
  async ({ supabase, params }) =>
    Response.json(await reverseMovement(supabase, params.id), { status: 201 }),
);
