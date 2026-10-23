import { withApi } from "@/lib/api/with-api";
import { assertNoQuery } from "@/server/costing/at-date";
import { getPlateMarginPcts } from "@/server/costing/percentages";

// The chef's only cost read (V6.2): percentages and a status word, no euro. The waiter reads nothing.
export const GET = withApi({ roles: ["owner", "admin", "chef"] }, async ({ request, supabase }) => {
  assertNoQuery(new URL(request.url));
  return Response.json(await getPlateMarginPcts(supabase));
});
