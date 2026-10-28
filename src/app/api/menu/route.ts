import { withApi } from "@/lib/api/with-api";
import { getServiceMenu } from "@/server/menu/service-menu";

// The service menu: owner, admin and waiter. The chef gets 403 before any RPC (M17 plan §3.1.7, Q70).
export const GET = withApi({ roles: ["owner", "admin", "waiter"] }, async ({ supabase }) =>
  Response.json(await getServiceMenu(supabase)),
);
