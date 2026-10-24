import { withApi } from "@/lib/api/with-api";
import { MAX_RULES_BODY_BYTES } from "@/server/rules/constants";
import { listIngredientRules, setIngredientRules } from "@/server/rules/ingredients";
import { ingredientRulesBody } from "@/server/rules/schemas";

// Reads: owner, admin and chef (the waiter gets 403 before any RPC). Writes: owner and admin; the procedures check
// the role again in Postgres.
export const GET = withApi({ roles: ["owner", "admin", "chef"] }, async ({ supabase, session }) =>
  Response.json(await listIngredientRules(supabase, session.role)),
);

export const PATCH = withApi(
  { roles: ["owner", "admin"], body: ingredientRulesBody, maxBodyBytes: MAX_RULES_BODY_BYTES },
  async ({ supabase, body }) => Response.json(await setIngredientRules(supabase, body)),
);
