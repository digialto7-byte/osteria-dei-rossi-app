import { withApi } from "@/lib/api/with-api";
import { offlineCacheable } from "@/lib/api/offline-cache";
import { getServiceMenu } from "@/server/menu/service-menu";

// The service menu: owner, admin and waiter. The chef gets 403 before any RPC (M17 plan §3.1.7, Q70).
export const GET = withApi({ roles: ["owner", "admin", "waiter"] }, async ({ supabase }) =>
  offlineCacheable(Response.json(await getServiceMenu(supabase))),
);
