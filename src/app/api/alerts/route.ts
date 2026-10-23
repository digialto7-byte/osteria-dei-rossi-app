import { withApi } from "@/lib/api/with-api";
import { listAlerts, parseListAlertsQuery } from "@/server/alerts/list";

// Owner and chef only (founder, 2026-10-23): admin and waiter get 403 before any query. The chef's
// rows are narrowed by RLS and again in listAlerts.
export const GET = withApi({ roles: ["owner", "chef"] }, async ({ request, supabase, session }) =>
  Response.json(
    await listAlerts(supabase, session.role, parseListAlertsQuery(new URL(request.url))),
  ),
);
