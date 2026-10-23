import { withApi } from "@/lib/api/with-api";
import { getMovements } from "@/server/stock/movements";
import { parseMovementsQuery } from "@/server/stock/schemas";

export const GET = withApi({ roles: ["owner", "admin", "chef"] }, async ({ request, supabase }) =>
  Response.json(await getMovements(supabase, parseMovementsQuery(new URL(request.url)))),
);
