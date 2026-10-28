import { withApi } from "@/lib/api/with-api";
import { getKitchenTickets } from "@/server/kitchen/tickets";

// Chef, owner and admin read the kitchen list; the waiter gets 403 before any RPC. Never cached: the screen polls it.
export const GET = withApi({ roles: ["chef", "owner", "admin"] }, async ({ supabase }) =>
  Response.json(await getKitchenTickets(supabase), { headers: { "cache-control": "no-store" } }),
);
