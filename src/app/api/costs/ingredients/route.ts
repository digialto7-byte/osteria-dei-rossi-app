import { withApi } from "@/lib/api/with-api";
import { parseAtDate } from "@/server/costing/at-date";
import { getIngredientCosts } from "@/server/costing/ingredients";

export const GET = withApi({ roles: ["owner", "admin"] }, async ({ request, supabase }) =>
  Response.json(await getIngredientCosts(supabase, parseAtDate(new URL(request.url)))),
);
