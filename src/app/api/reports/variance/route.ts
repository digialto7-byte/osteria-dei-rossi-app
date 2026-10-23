import { withApi } from "@/lib/api/with-api";
import { parseVarianceQuery } from "@/server/counts/schemas";
import { getVariance } from "@/server/counts/variance";

export const GET = withApi({ roles: ["owner", "admin", "chef"] }, async ({ request, supabase }) =>
  Response.json(await getVariance(supabase, parseVarianceQuery(new URL(request.url)).session)),
);
