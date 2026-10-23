import { withApi } from "@/lib/api/with-api";
import { loadRecipeDetail } from "@/server/recipes/detail";
import { versionParams } from "@/server/recipes/schemas";

export const GET = withApi(
  { roles: ["owner", "admin", "chef"], params: versionParams },
  async ({ supabase, session, params }) =>
    Response.json({
      recipe: await loadRecipeDetail(supabase, session.role, params.key, params.version),
    }),
);
