import { withApi } from "@/lib/api/with-api";
import { parseVarianceQuery } from "@/server/counts/schemas";
import { getVarianceCosts } from "@/server/counts/variance-costs";

// EUR: owner and admin only. The chef and the waiter are refused here, before any RPC (Q16 = V6).
export const GET = withApi({ roles: ["owner", "admin"] }, async ({ request, supabase }) =>
  Response.json(await getVarianceCosts(supabase, parseVarianceQuery(new URL(request.url)).session)),
);
