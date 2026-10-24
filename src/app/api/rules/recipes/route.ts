import { withApi } from "@/lib/api/with-api";
import { MAX_RULES_BODY_BYTES } from "@/server/rules/constants";
import { listRecipeRules, setRecipeRules } from "@/server/rules/recipes";
import { recipeRulesBody } from "@/server/rules/schemas";

export const GET = withApi({ roles: ["owner", "admin", "chef"] }, async ({ supabase }) =>
  Response.json(await listRecipeRules(supabase)),
);

export const PATCH = withApi(
  { roles: ["owner", "admin"], body: recipeRulesBody, maxBodyBytes: MAX_RULES_BODY_BYTES },
  async ({ supabase, body }) => Response.json(await setRecipeRules(supabase, body)),
);
