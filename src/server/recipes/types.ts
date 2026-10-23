import type { Allergen } from "@/server/master/ingredients";

export const RECIPE_TYPES = ["batch", "plate", "sub"] as const;
export type RecipeType = (typeof RECIPE_TYPES)[number];

/** Units a recipe line may use; `porz` (portions) only for a batch used by a plate. */
export const RECIPE_UNITS = ["kg", "g", "l", "ml", "pz", "porz"] as const;
export type RecipeUnit = (typeof RECIPE_UNITS)[number];

/** What a batch or sub-recipe produces. */
export const OUTPUT_UNITS = ["kg", "l", "pz"] as const;
export type OutputUnit = (typeof OUTPUT_UNITS)[number];

/** A line of the import / export template: targets by name. */
export interface TemplateLine {
  ingredient?: string;
  recipe?: string;
  qty: number;
  unit: RecipeUnit;
  yieldFactor?: number;
}

/** A recipe of the import / export template (`salePrice` null = clear, absent = keep). */
export interface RecipeTemplate {
  name: string;
  type: RecipeType;
  outputQty?: number;
  outputUnit?: OutputUnit;
  portionsPerBatch?: number;
  shelfLifeHours?: number;
  prepTimeMin?: number;
  minPortions?: number;
  targetPortions?: number;
  salePrice?: number | null;
  targetGpPct?: number | null;
  lines: TemplateLine[];
}

/** A template recipe with the file line it came from (for error messages). */
export type RecipeImportRow = RecipeTemplate & { row: number };

export interface AllergenSummary {
  list: Allergen[];
  status: "confirmed" | "da_confermare";
  unconfirmedIngredients: { id: string; name: string }[];
}
