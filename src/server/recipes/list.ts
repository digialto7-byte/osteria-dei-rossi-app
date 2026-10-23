import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { RECIPE_LIST_LIMIT } from "./constants";
import {
  buildAllergenSummary,
  loadAllergenRows,
  loadIngredientNames,
  unwrap,
  type RecipeSummary,
} from "./detail";
import { RECIPE_TYPES, type RecipeType } from "./types";

const ACTIVE_FILTERS = ["true", "false", "all"] as const;

const listQuery = z.strictObject({
  type: z.enum(RECIPE_TYPES).optional(),
  active: z.enum(ACTIVE_FILTERS).optional(),
});

export interface ListRecipesQuery {
  type: RecipeType | null;
  active: boolean | "all";
}

/** `?type=batch|plate|sub` and `?active=true|false|all` (default true); any other parameter is a 400. */
export function parseListRecipesQuery(url: URL): ListRecipesQuery {
  const parsed = listQuery.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) throw new ApiError(400, "invalid_request", "Filtri non validi.");
  const { type, active } = parsed.data;
  return { type: type ?? null, active: active === "all" ? "all" : active !== "false" };
}

interface ListRow {
  recipe_key: string;
  name: string;
  type: RecipeType;
  is_active: boolean;
  version: number;
  valid_from: string;
}

/**
 * The current version of each recipe with its allergen state, sorted by name in Italian. The query
 * orders by name then key before it cuts to RECIPE_LIST_LIMIT, so past the cap the list is the
 * first recipes in the database's name order (stable, same set on every call); the Italian sort
 * below only arranges those rows for display.
 */
export async function listRecipes(
  supabase: SupabaseClient,
  query: ListRecipesQuery,
): Promise<{ recipes: RecipeSummary[] }> {
  let request = supabase
    .from("v_recipe_current")
    .select("recipe_key, name, type, is_active, version, valid_from");
  if (query.type) request = request.eq("type", query.type);
  if (query.active !== "all") request = request.eq("is_active", query.active);
  const rows =
    unwrap<ListRow[] | null>(
      await request.order("name").order("recipe_key").limit(RECIPE_LIST_LIMIT),
    ) ?? [];
  rows.sort(
    (a, b) => a.name.localeCompare(b.name, "it") || a.recipe_key.localeCompare(b.recipe_key),
  );
  if (rows.length === 0) return { recipes: [] };

  const summaries = await loadAllergenRows(
    supabase,
    rows.map((row) => row.recipe_key),
  );
  const unconfirmed = [...summaries.values()].flatMap((row) => row.unconfirmed_ingredient_ids);
  const names = await loadIngredientNames(supabase, [...new Set(unconfirmed)]);
  return {
    recipes: rows.map((row) => ({
      key: row.recipe_key,
      name: row.name,
      type: row.type,
      version: row.version,
      validFrom: row.valid_from,
      isActive: row.is_active,
      allergens: buildAllergenSummary(summaries.get(row.recipe_key), names),
    })),
  };
}
