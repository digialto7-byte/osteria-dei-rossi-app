import { withApi } from "@/lib/api/with-api";
import { parseAtDate } from "@/server/costing/at-date";
import { getPlateCosts } from "@/server/costing/plates";

export const GET = withApi(
  { roles: ["owner", "admin"] },
  async ({ request, supabase, session, tenantSettings }) =>
    Response.json(
      await getPlateCosts(
        supabase,
        session,
        parseAtDate(new URL(request.url), (await tenantSettings()).timeZone),
      ),
    ),
);
