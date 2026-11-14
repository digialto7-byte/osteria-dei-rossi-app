import { withApi } from "@/lib/api/with-api";
import { parseQuery } from "@/server/counts/schemas";
import { searchLots } from "@/server/trace/lots";
import { traceLotsQuery } from "@/server/trace/schemas";

// Owner, admin and chef; the waiter gets 403 before any RPC. Never offline-cached (plan §3.7).
export const GET = withApi({ roles: ["owner", "admin", "chef"] }, async ({ request, supabase }) => {
  const query = parseQuery(traceLotsQuery, new URL(request.url));
  return Response.json(await searchLots(supabase, query));
});
