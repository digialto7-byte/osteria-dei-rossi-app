import { withApi } from "@/lib/api/with-api";
import { getLots } from "@/server/stock/lots";
import { parseLotsQuery } from "@/server/stock/schemas";

export const GET = withApi({ roles: ["owner", "admin", "chef"] }, async ({ request, supabase }) =>
  Response.json(await getLots(supabase, parseLotsQuery(new URL(request.url)))),
);
