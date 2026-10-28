import { withApi } from "@/lib/api/with-api";
import { assertNoQuery, parseAtDate } from "@/server/costing/at-date";
import { getPlateBreakdown } from "@/server/costing/plate-breakdown";
import { keyParams } from "@/server/recipes/schemas";

// One plate's cost by line. Owner and admin read euro figures and may ask for a day; the chef reads percentages only
// (V6) and only for now, so a query from the chef is a 400; the waiter gets 403 before any query.
export const GET = withApi(
  { roles: ["owner", "admin", "chef"], params: keyParams },
  async ({ request, supabase, session, params }) => {
    const url = new URL(request.url);
    let at: string | null = null;
    if (session.role === "chef") assertNoQuery(url);
    else at = parseAtDate(url);
    return Response.json(await getPlateBreakdown(supabase, session.role, params.key, at));
  },
);
