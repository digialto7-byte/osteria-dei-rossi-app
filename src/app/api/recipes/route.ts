import { withApi } from "@/lib/api/with-api";
import { MAX_RECIPE_BODY_BYTES } from "@/server/recipes/constants";
import { listRecipes, parseListRecipesQuery } from "@/server/recipes/list";
import { createRecipeBody } from "@/server/recipes/schemas";
import { createRecipe } from "@/server/recipes/write";

// Waiters see no recipes in M7 (plan §3.11.2): 403 before any query.
const READERS = ["owner", "admin", "chef"] as const;

export const GET = withApi({ roles: READERS }, async ({ request, supabase }) =>
  Response.json(await listRecipes(supabase, parseListRecipesQuery(new URL(request.url)))),
);

export const POST = withApi(
  { roles: READERS, body: createRecipeBody, maxBodyBytes: MAX_RECIPE_BODY_BYTES },
  async ({ supabase, session, body }) =>
    Response.json(await createRecipe(supabase, session, body), { status: 201 }),
);
