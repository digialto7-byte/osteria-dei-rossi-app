import { withApi } from "@/lib/api/with-api";
import { MAX_KITCHEN_BODY_BYTES } from "@/server/kitchen/constants";
import { markKitchenLine } from "@/server/kitchen/marks";
import { markLineBody } from "@/server/kitchen/schemas";
import { idParams } from "@/server/orders/schemas";
import { measured } from "@/server/orders/timing";

// Chef, owner and admin mark a dish; the waiter gets 403 before any RPC (the database refuses too). Never cached.
export const POST = withApi(
  {
    roles: ["chef", "owner", "admin"],
    params: idParams,
    body: markLineBody,
    maxBodyBytes: MAX_KITCHEN_BODY_BYTES,
  },
  async ({ supabase, params, body, timing }) => {
    const { result, header } = await measured(timing, () =>
      markKitchenLine(supabase, params.id, body),
    );
    return Response.json(result, {
      headers: { "server-timing": header, "cache-control": "no-store" },
    });
  },
);
