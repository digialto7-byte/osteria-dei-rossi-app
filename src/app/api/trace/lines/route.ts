import { withApi } from "@/lib/api/with-api";
import { parseQuery } from "@/server/counts/schemas";
import { searchLines } from "@/server/trace/lines";
import { traceLinesQuery } from "@/server/trace/schemas";

export const GET = withApi({ roles: ["owner", "admin", "chef"] }, async ({ request, supabase }) => {
  const query = parseQuery(traceLinesQuery, new URL(request.url));
  return Response.json(await searchLines(supabase, query));
});
