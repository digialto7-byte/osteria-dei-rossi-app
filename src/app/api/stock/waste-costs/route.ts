import { withApi } from "@/lib/api/with-api";
import { parseWasteCostsQuery } from "@/server/stock/schemas";
import { getWasteCosts } from "@/server/stock/waste-costs";

// Waste in EUR is a cost: owner and admin only (Q16 = V6). 403 for the chef and the waiter before any RPC. This is
// the only stock endpoint with a euro value.
export const GET = withApi({ roles: ["owner", "admin"] }, async ({ request, supabase }) =>
  Response.json(await getWasteCosts(supabase, parseWasteCostsQuery(new URL(request.url)))),
);
