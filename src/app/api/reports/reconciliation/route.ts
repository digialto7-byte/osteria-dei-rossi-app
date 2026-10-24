import { withApi } from "@/lib/api/with-api";
import { getReconciliation } from "@/server/counts/reconciliation";
import { parseReconciliationQuery } from "@/server/counts/schemas";

export const GET = withApi({ roles: ["owner", "admin", "chef"] }, async ({ request, supabase }) =>
  Response.json(await getReconciliation(supabase, parseReconciliationQuery(new URL(request.url)))),
);
