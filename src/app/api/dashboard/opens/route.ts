import { withApi } from "@/lib/api/with-api";
import { MAX_OPENS_BODY_BYTES, opensBody, recordDashboardOpen } from "@/server/dashboard/opens";
import { measured, timedJson } from "@/server/orders/timing";

// The owner only (Q150): the admin, the chef and the waiter get 403 before any RPC, and the database refuses them too. The body is `{}`: who and
// when come from the session and the clock, so nothing a client sends can change another person's count.
export const POST = withApi(
  { roles: ["owner"], body: opensBody, maxBodyBytes: MAX_OPENS_BODY_BYTES },
  async ({ supabase, timing }) => {
    const { result, header } = await measured(timing, () => recordDashboardOpen(supabase));
    return timedJson(result, header);
  },
);
