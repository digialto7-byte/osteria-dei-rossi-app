import { withApi } from "@/lib/api/with-api";
import { getStock } from "@/server/stock/on-hand";
import { parseStockQuery } from "@/server/stock/schemas";

// Stock quantities: owner, admin and chef (the waiter has no access, plan §3.10). 403 before any query for the
// others. Quantities only: no EUR for anyone (Q16 = V6).
export const GET = withApi({ roles: ["owner", "admin", "chef"] }, async ({ request, supabase }) =>
  Response.json(await getStock(supabase, parseStockQuery(new URL(request.url)))),
);
