import { withApi } from "@/lib/api/with-api";
import { parseQuery } from "@/server/counts/schemas";
import { reportQuery } from "@/server/day-close/schemas";
import { getAppVsRegister } from "@/server/day-close/report";

// Owner and admin only (the report holds the register total and who closed what); the waiter and the chef get 403 before any RPC.
export const GET = withApi({ roles: ["owner", "admin"] }, async ({ request, supabase }) => {
  const { date } = parseQuery(reportQuery, new URL(request.url));
  return Response.json(await getAppVsRegister(supabase, date));
});
