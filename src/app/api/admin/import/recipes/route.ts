import { withApi } from "@/lib/api/with-api";
import { MAX_IMPORT_BODY_BYTES } from "@/server/master/import";
import { importRecipes, recipeImportBody } from "@/server/recipes/import";

// Recipe import is the admin's (DigiAlto support) and the owner's; the chef does not import.
export const POST = withApi(
  { roles: ["owner", "admin"], body: recipeImportBody, maxBodyBytes: MAX_IMPORT_BODY_BYTES },
  async ({ supabase, body }) => Response.json(await importRecipes(supabase, body)),
);
