import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import type { TenantSession } from "@/lib/api/with-api";
import { t } from "@/lib/i18n";
import { contentOf } from "./content";
import { loadRecipeDetail, unwrap, type RecipeDetail } from "./detail";
import { mapRecipeDbError } from "./errors";
import { assertValidRecipeContent, type createRecipeBody, type newVersionBody } from "./schemas";
import type { RecipeType } from "./types";

export interface RecipeWarning {
  line: number;
  code: string;
}

export interface WriteResult {
  recipe: RecipeDetail;
  warnings: RecipeWarning[];
}

interface Written {
  key: string;
  version: number;
  warnings?: RecipeWarning[];
}

// Q16 = V6 and AT5: the chef reads the price fields but never sets them, so a chef body that names
// either one is refused here, before the database. The procedure refuses it too (it is the authority).
function refuseChefPrice(session: TenantSession, body: object) {
  if (
    session.role === "chef" &&
    (Object.hasOwn(body, "salePrice") || Object.hasOwn(body, "targetGpPct"))
  ) {
    throw new ApiError(403, "recipe_price_forbidden", t("recipeError.recipe_price_forbidden"));
  }
}

async function finish(
  supabase: SupabaseClient,
  session: TenantSession,
  written: Written,
): Promise<WriteResult> {
  return {
    recipe: await loadRecipeDetail(supabase, session.role, written.key),
    warnings: written.warnings ?? [],
  };
}

export async function createRecipe(
  supabase: SupabaseClient,
  session: TenantSession,
  body: z.infer<typeof createRecipeBody>,
): Promise<WriteResult> {
  refuseChefPrice(session, body);
  const content = contentOf(body);
  assertValidRecipeContent(body.type, content);
  const { data, error } = await supabase.rpc("create_recipe", {
    p_type: body.type,
    p_content: content,
  });
  if (error) throw mapRecipeDbError(error);
  return finish(supabase, session, data as Written);
}

export async function createRecipeVersion(
  supabase: SupabaseClient,
  session: TenantSession,
  key: string,
  body: z.infer<typeof newVersionBody>,
): Promise<WriteResult> {
  refuseChefPrice(session, body);
  // The type never changes and decides which fields apply, so read it before validating.
  const found = unwrap<{ type: RecipeType } | null>(
    await supabase.from("recipe_key").select("type").eq("id", key).maybeSingle(),
  );
  if (!found) throw new ApiError(404, "not_found", "Risorsa non trovata.");
  const content = contentOf(body);
  assertValidRecipeContent(found.type, content);
  const { data, error } = await supabase.rpc("create_recipe_version", {
    p_key: key,
    p_base_version: body.baseVersion,
    p_content: content,
  });
  if (error) throw mapRecipeDbError(error);
  return finish(supabase, session, data as Written);
}

export async function setRecipeActive(
  supabase: SupabaseClient,
  session: TenantSession,
  key: string,
  isActive: boolean,
): Promise<{ recipe: RecipeDetail }> {
  const { error } = await supabase.rpc("set_recipe_active", { p_key: key, p_active: isActive });
  if (error) throw mapRecipeDbError(error);
  return { recipe: await loadRecipeDetail(supabase, session.role, key) };
}
