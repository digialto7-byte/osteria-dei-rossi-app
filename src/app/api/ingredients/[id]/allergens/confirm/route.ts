import { withApi } from "@/lib/api/with-api";
import { confirmAllergensBody, confirmIngredientAllergens } from "@/server/master/allergens";
import { idParams } from "@/server/master/schemas";

// Q6 = owner only (founder 2026-10-23): admin (DigiAlto support) and chef never confirm allergens.
export const POST = withApi(
  { roles: ["owner"], params: idParams, body: confirmAllergensBody },
  async ({ supabase, params, body }) =>
    Response.json({ ingredient: await confirmIngredientAllergens(supabase, params.id, body) }),
);
