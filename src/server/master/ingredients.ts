import { z } from "zod";
import { BASE_UNITS, type BaseUnit } from "@/lib/units";
import { definedOnly, type ResourceSpec } from "./resource";
import { NON_EMPTY_MESSAGE, nonEmpty, trimmedText } from "./schemas";

/** The 14 allergen groups of EU Regulation 1169/2011, Annex II (enum public.allergen). */
export const ALLERGENS = [
  "glutine",
  "crostacei",
  "uova",
  "pesce",
  "arachidi",
  "soia",
  "latte",
  "frutta_a_guscio",
  "sedano",
  "senape",
  "sesamo",
  "solfiti",
  "lupini",
  "molluschi",
] as const;
export type Allergen = (typeof ALLERGENS)[number];

const MAX_SHELF_LIFE_DAYS = 3650;

/**
 * confirmed: a person confirmed the list; unknown: nothing stated; declared: a list nobody has
 * confirmed. Screens show "da confermare" for unknown and declared. Never read a null list as none.
 */
export type AllergenStatus = "confirmed" | "unknown" | "declared";

/** A list of allergens, de-duplicated; the empty list is the valid "declared: none". */
export const allergenList = z
  .array(z.enum(ALLERGENS))
  .max(ALLERGENS.length)
  .transform((list) => [...new Set(list)]);

interface IngredientRow {
  id: string;
  name: string;
  base_unit: BaseUnit;
  category: string | null;
  is_stock: boolean;
  allergens: Allergen[] | null;
  allergen_status: AllergenStatus;
  allergens_confirmed_at: string | null;
  default_shelf_life_days: number | null;
  is_active: boolean;
}

export interface Ingredient {
  id: string;
  name: string;
  baseUnit: BaseUnit;
  category: string | null;
  isStock: boolean;
  /** null = not stated (not "none"). */
  allergens: Allergen[] | null;
  allergenStatus: AllergenStatus;
  allergensConfirmedAt: string | null;
  defaultShelfLifeDays: number | null;
  isActive: boolean;
}

export const ingredientSpec: ResourceSpec<IngredientRow, Ingredient> = {
  table: "ingredient",
  columns:
    "id, name, base_unit, category, is_stock, allergens, allergen_status, allergens_confirmed_at, default_shelf_life_days, is_active",
  toItem: (row) => ({
    id: row.id,
    name: row.name,
    baseUnit: row.base_unit,
    category: row.category,
    isStock: row.is_stock,
    allergens: row.allergens,
    allergenStatus: row.allergen_status,
    allergensConfirmedAt: row.allergens_confirmed_at,
    defaultShelfLifeDays: row.default_shelf_life_days,
    isActive: row.is_active,
  }),
};

const editable = {
  category: z.string().trim().max(60).nullable().optional(),
  isStock: z.boolean().optional(),
  // null: back to "not stated". Changing the list clears a confirmation (database trigger).
  allergens: allergenList.nullable().optional(),
  defaultShelfLifeDays: z.number().int().min(1).max(MAX_SHELF_LIFE_DAYS).nullable().optional(),
};

export const createIngredientBody = z.object({
  name: trimmedText(120),
  baseUnit: z.enum(BASE_UNITS),
  ...editable,
});

// No baseUnit: it is fixed at creation (later ledgers are in that unit).
export const updateIngredientBody = z
  .object({ name: trimmedText(120).optional(), ...editable, isActive: z.boolean().optional() })
  .refine(nonEmpty, NON_EMPTY_MESSAGE);

type Editable = Partial<z.infer<typeof updateIngredientBody>>;

function editableColumns(body: Editable) {
  return {
    name: body.name,
    category: body.category,
    is_stock: body.isStock,
    allergens: body.allergens,
    default_shelf_life_days: body.defaultShelfLifeDays,
  };
}

export function ingredientInsert(body: z.infer<typeof createIngredientBody>) {
  return definedOnly({ ...editableColumns(body), base_unit: body.baseUnit });
}

export function ingredientPatch(body: z.infer<typeof updateIngredientBody>) {
  return definedOnly({ ...editableColumns(body), is_active: body.isActive });
}
