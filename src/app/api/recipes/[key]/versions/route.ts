import { withApi } from "@/lib/api/with-api";
import { MAX_RECIPE_BODY_BYTES } from "@/server/recipes/constants";
import { keyParams, newVersionBody } from "@/server/recipes/schemas";
import { createRecipeVersion } from "@/server/recipes/write";

export const POST = withApi(
  {
    roles: ["owner", "admin", "chef"],
    params: keyParams,
    body: newVersionBody,
    maxBodyBytes: MAX_RECIPE_BODY_BYTES,
  },
  async ({ supabase, session, params, body }) =>
    Response.json(await createRecipeVersion(supabase, session, params.key, body), { status: 201 }),
);
