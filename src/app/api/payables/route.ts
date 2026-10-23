import { withApi } from "@/lib/api/with-api";
import { listPayables, parsePayableListQuery } from "@/server/payables/list";

// Payables are money: owner and admin only (plan §3.11.2). 403 before any query for the others.
export const GET = withApi({ roles: ["owner", "admin"] }, async ({ request, supabase }) =>
  Response.json(await listPayables(supabase, parsePayableListQuery(new URL(request.url)))),
);
