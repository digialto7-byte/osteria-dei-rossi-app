import { withApi } from "@/lib/api/with-api";
import {
  createIngredientBody,
  ingredientInsert,
  ingredientSpec,
} from "@/server/master/ingredients";
import { insertRow, listRows, parseActiveFilter } from "@/server/master/resource";

export const GET = withApi({ roles: ["owner", "admin", "chef"] }, async ({ request, supabase }) =>
  Response.json({
    ingredients: await listRows(supabase, ingredientSpec, parseActiveFilter(new URL(request.url))),
  }),
);

export const POST = withApi(
  { roles: ["owner", "admin"], body: createIngredientBody },
  async ({ supabase, body }) =>
    Response.json(
      { ingredient: await insertRow(supabase, ingredientSpec, ingredientInsert(body)) },
      { status: 201 },
    ),
);
