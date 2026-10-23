import { withApi } from "@/lib/api/with-api";
import { setIngredientCostBasis } from "@/server/costing/cost-basis";
import { costBasisBody } from "@/server/costing/schemas";
import { idParams } from "@/server/master/schemas";

// How an ingredient is costed (average or last price): owner and admin (Q11); the chef cannot see it (V6).
export const PUT = withApi(
  { roles: ["owner", "admin"], params: idParams, body: costBasisBody },
  async ({ supabase, params, body }) =>
    Response.json(await setIngredientCostBasis(supabase, params.id, body.basis)),
);
