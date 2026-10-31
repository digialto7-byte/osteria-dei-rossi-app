import { withApi } from "@/lib/api/with-api";
import { MAX_DAY_CLOSE_BODY_BYTES } from "@/server/day-close/constants";
import { enterDayClose } from "@/server/day-close/enter";
import { dayCloseBody } from "@/server/day-close/schemas";
import { measured, timedJson } from "@/server/orders/timing";

// Owner and admin only: the waiter and the chef get 403 before any RPC (AT5). The database refuses them too, and no API role may insert.
export const POST = withApi(
  { roles: ["owner", "admin"], body: dayCloseBody, maxBodyBytes: MAX_DAY_CLOSE_BODY_BYTES },
  async ({ supabase, body, timing }) => {
    const { result, header } = await measured(timing, () => enterDayClose(supabase, body));
    return timedJson(result, header);
  },
);
