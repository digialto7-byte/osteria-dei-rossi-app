import { withApi } from "@/lib/api/with-api";
import { parseQuery } from "@/server/counts/schemas";
import { measured, timedJson } from "@/server/orders/timing";
import { MAX_SERVICES_BODY_BYTES } from "@/server/services/constants";
import { noQuery, servicesBody } from "@/server/services/schemas";
import { readServices, saveServices } from "@/server/services/settings";

// Owner and admin only: the chef and the waiter get 403 before any RPC. The functions behind it are SECURITY DEFINER and check the role again.
const MANAGERS = ["owner", "admin"] as const;

export const GET = withApi({ roles: MANAGERS }, async ({ request, supabase, timing }) => {
  parseQuery(noQuery, new URL(request.url));
  const { result, header } = await measured(timing, () => readServices(supabase));
  return timedJson(result, header);
});

export const PATCH = withApi(
  { roles: MANAGERS, body: servicesBody, maxBodyBytes: MAX_SERVICES_BODY_BYTES },
  async ({ supabase, body, timing }) => {
    const { result, header } = await measured(timing, () => saveServices(supabase, body));
    return timedJson(result, header);
  },
);
