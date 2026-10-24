import { withApi } from "@/lib/api/with-api";
import { getAuditLog } from "@/server/audit/log";
import { parseAuditQuery } from "@/server/audit/schemas";

// Owner and admin only (Q39): the chef and the waiter are refused here, before any RPC.
export const GET = withApi({ roles: ["owner", "admin"] }, async ({ request, supabase }) =>
  Response.json(await getAuditLog(supabase, parseAuditQuery(new URL(request.url)))),
);
