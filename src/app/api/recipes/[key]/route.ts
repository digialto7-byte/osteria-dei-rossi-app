import { withApi } from "@/lib/api/with-api";
import { loadRecipeDetail } from "@/server/recipes/detail";
import { keyParams, setActiveBody } from "@/server/recipes/schemas";
import { setRecipeActive } from "@/server/recipes/write";

export const GET = withApi(
  { roles: ["owner", "admin", "chef"], params: keyParams },
  async ({ supabase, session, params }) =>
    Response.json({ recipe: await loadRecipeDetail(supabase, session.role, params.key) }),
);

// Deactivating is for owner and admin; the chef's write right is new versions (plan A2).
export const PATCH = withApi(
  { roles: ["owner", "admin"], params: keyParams, body: setActiveBody },
  async ({ supabase, session, params, body }) =>
    Response.json(await setRecipeActive(supabase, session, params.key, body.isActive)),
);
