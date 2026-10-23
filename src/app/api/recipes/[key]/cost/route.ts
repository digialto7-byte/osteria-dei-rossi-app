import { withApi } from "@/lib/api/with-api";
import { parseAtDate } from "@/server/costing/at-date";
import { getRecipeCost } from "@/server/costing/recipe-cost";
import { keyParams } from "@/server/recipes/schemas";

// Costs in euro are for the owner and the admin (Q16 = V6): the chef and the waiter get 403 before any query.
export const GET = withApi(
  { roles: ["owner", "admin"], params: keyParams },
  async ({ request, supabase, params }) => {
    const at = parseAtDate(new URL(request.url));
    return Response.json({ cost: await getRecipeCost(supabase, params.key, at) });
  },
);
