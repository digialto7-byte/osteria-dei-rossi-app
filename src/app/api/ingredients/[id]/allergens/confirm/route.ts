import { withApi } from "@/lib/api/with-api";
import { confirmAllergensBody, confirmIngredientAllergens } from "@/server/master/allergens";
import { idParams } from "@/server/master/schemas";

// Q6 default: owner and admin may confirm (variant V6 narrows it to the owner).
export const POST = withApi(
  { roles: ["owner", "admin"], params: idParams, body: confirmAllergensBody },
  async ({ supabase, params, body }) =>
    Response.json({ ingredient: await confirmIngredientAllergens(supabase, params.id, body) }),
);
