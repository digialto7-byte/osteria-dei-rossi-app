import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { MAX_IMPORT_CHARS, MAX_IMPORT_ROWS } from "@/server/master/import";
import { toRpcRow } from "./content";
import { mapRecipeDbError } from "./errors";
import { recipeRowsFromCsv, recipeRowsFromJson, type MappedRecipes } from "./import-template";

export const recipeImportBody = z.discriminatedUnion("format", [
  z.strictObject({
    format: z.literal("csv"),
    csv: z.string().max(MAX_IMPORT_CHARS),
    dryRun: z.boolean().optional(),
  }),
  z.strictObject({
    format: z.literal("json"),
    recipes: z.array(z.unknown()).max(MAX_IMPORT_ROWS),
    dryRun: z.boolean().optional(),
  }),
]);
export type RecipeImportBody = z.infer<typeof recipeImportBody>;

export type ImportAction = "create" | "new_version" | "unchanged";

export interface RecipeImportResult {
  dryRun: boolean;
  created: number;
  newVersions: number;
  unchanged: number;
  recipes: {
    row: number;
    name: string;
    action: ImportAction;
    version: number;
    warnings: { line: number; code: string }[];
  }[];
}

/** Only the documented fields travel on, whatever the procedure returned. */
function toResult(data: RecipeImportResult): RecipeImportResult {
  return {
    dryRun: data.dryRun,
    created: data.created,
    newVersions: data.newVersions,
    unchanged: data.unchanged,
    recipes: data.recipes.map((recipe) => ({
      row: recipe.row,
      name: recipe.name,
      action: recipe.action,
      version: recipe.version,
      warnings: recipe.warnings,
    })),
  };
}

/**
 * Validates the whole file, then imports it in one database transaction, or none. With `dryRun` the
 * same procedure runs and rolls back, so the preview is exactly what the import would do. Errors name
 * the file row, the field and a code, never the contents of a cell.
 */
export async function importRecipes(
  supabase: SupabaseClient,
  body: RecipeImportBody,
): Promise<RecipeImportResult> {
  const mapped: MappedRecipes =
    body.format === "csv" ? recipeRowsFromCsv(body.csv) : recipeRowsFromJson(body.recipes);
  if (mapped.errors.length > 0) {
    throw new ApiError(422, "import_invalid", "Il file contiene righe non valide.", mapped.errors);
  }
  const { data, error } = await supabase.rpc("import_recipes", {
    p_rows: mapped.rows.map(toRpcRow),
    p_dry_run: body.dryRun ?? false,
  });
  if (error) throw mapRecipeDbError(error);
  return toResult(data as RecipeImportResult);
}
