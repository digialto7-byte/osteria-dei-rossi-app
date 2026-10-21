import { withApi } from "@/lib/api/with-api";
import { ingredientPatch, ingredientSpec, updateIngredientBody } from "@/server/master/ingredients";
import { getRow, updateRow } from "@/server/master/resource";
import { idParams } from "@/server/master/schemas";

export const GET = withApi(
  { roles: ["owner", "admin", "chef"], params: idParams },
  async ({ supabase, params }) =>
    Response.json({ ingredient: await getRow(supabase, ingredientSpec, params.id) }),
);

export const PATCH = withApi(
  { roles: ["owner", "admin"], params: idParams, body: updateIngredientBody },
  async ({ supabase, params, body }) =>
    Response.json({
      ingredient: await updateRow(supabase, ingredientSpec, params.id, ingredientPatch(body)),
    }),
);
