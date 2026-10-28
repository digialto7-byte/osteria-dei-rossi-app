import { withApi } from "@/lib/api/with-api";
import { MAX_FIRE_BODY_BYTES } from "@/server/orders/constants";
import { fireCourse } from "@/server/orders/fire";
import { fireBody, idParams } from "@/server/orders/schemas";
import { measured, timedJson } from "@/server/orders/timing";

// Owner, admin and waiter; the chef gets 403 before any RPC (the chef does not send courses in the MVP, variant V3).
export const POST = withApi(
  {
    roles: ["owner", "admin", "waiter"],
    params: idParams,
    body: fireBody,
    maxBodyBytes: MAX_FIRE_BODY_BYTES,
  },
  async ({ supabase, params, body, timing }) => {
    const { result, header } = await measured(timing, () => fireCourse(supabase, params.id, body));
    return timedJson(result, header);
  },
);
