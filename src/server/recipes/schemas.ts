import { z } from "zod";
import { ApiError, type ErrorDetail } from "@/lib/api/errors";
import { t } from "@/lib/i18n";
import { MAX_NAME_LENGTH, MAX_QTY, MAX_RECIPE_LINES, MAX_YIELD_FACTOR } from "./constants";
import { OUTPUT_UNITS, RECIPE_TYPES, RECIPE_UNITS, type RecipeType } from "./types";

// Shapes only (a wrong shape is a 400 from withApi). Ranges are domain errors (422 recipe_invalid
// with a field and a code per problem), so the screen can point at the field and AT3 gets its 422.
const optionalNumber = z.number().nullable().optional();

const recipeLine = z.strictObject({
  ingredientId: z.uuid().optional(),
  recipeKey: z.uuid().optional(),
  qty: z.number(),
  unit: z.enum(RECIPE_UNITS),
  yieldFactor: z.number().optional(),
});

const contentShape = {
  name: z.string(),
  outputQty: optionalNumber,
  outputUnit: z.enum(OUTPUT_UNITS).nullable().optional(),
  portionsPerBatch: optionalNumber,
  shelfLifeHours: optionalNumber,
  prepTimeMin: optionalNumber,
  minPortions: optionalNumber,
  targetPortions: optionalNumber,
  salePrice: optionalNumber,
  targetGpPct: optionalNumber,
  lines: z.array(recipeLine),
};

export const createRecipeBody = z.strictObject({ type: z.enum(RECIPE_TYPES), ...contentShape });
export const newVersionBody = z.strictObject({
  baseVersion: z.number().int().min(1),
  ...contentShape,
});
export const setActiveBody = z.strictObject({ isActive: z.boolean() });

export type RecipeContent = Omit<z.infer<typeof createRecipeBody>, "type">;
export type RecipeLineBody = RecipeContent["lines"][number];

const WHOLE_NUMBER_DECIMALS = 0;
const TOLERANCE = 1e-7;

function hasAtMostDecimals(value: number, decimals: number): boolean {
  const scaled = Math.abs(value) * 10 ** decimals;
  return Math.abs(scaled - Math.round(scaled)) <= TOLERANCE * Math.max(1, scaled);
}

interface NumericRule {
  key: string;
  min: number;
  minExclusive?: boolean;
  max: number;
  maxExclusive?: boolean;
  decimals: number;
  types: readonly RecipeType[];
  required: readonly RecipeType[];
}

// Mirrors app.recipe_content_parse (the database is the authority; this gives the screen the same codes first).
const NUMERIC_RULES: readonly NumericRule[] = [
  {
    key: "outputQty",
    min: 0,
    minExclusive: true,
    max: MAX_QTY,
    decimals: 4,
    types: ["batch", "sub"],
    required: ["batch", "sub"],
  },
  {
    key: "portionsPerBatch",
    min: 1,
    max: 10_000,
    decimals: WHOLE_NUMBER_DECIMALS,
    types: ["batch"],
    required: ["batch"],
  },
  {
    key: "shelfLifeHours",
    min: 1,
    max: 8760,
    decimals: WHOLE_NUMBER_DECIMALS,
    types: ["batch"],
    required: ["batch"],
  },
  {
    key: "prepTimeMin",
    min: 0,
    max: 1440,
    decimals: WHOLE_NUMBER_DECIMALS,
    types: ["batch", "sub"],
    required: [],
  },
  {
    key: "minPortions",
    min: 0,
    max: 10_000,
    decimals: WHOLE_NUMBER_DECIMALS,
    types: ["batch"],
    required: [],
  },
  {
    key: "targetPortions",
    min: 0,
    max: 10_000,
    decimals: WHOLE_NUMBER_DECIMALS,
    types: ["batch"],
    required: [],
  },
  { key: "salePrice", min: 0, max: 100_000, decimals: 2, types: ["plate"], required: [] },
  {
    key: "targetGpPct",
    min: 0,
    max: 100,
    maxExclusive: true,
    decimals: 2,
    types: ["plate"],
    required: [],
  },
];
const PRICE_KEYS = new Set(["salePrice", "targetGpPct"]);

type Loose = Record<string, unknown>;
const isObject = (value: unknown): value is Loose =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function outOfRange(value: number, rule: NumericRule): boolean {
  return (
    (rule.minExclusive ? value <= rule.min : value < rule.min) ||
    (rule.maxExclusive ? value >= rule.max : value > rule.max) ||
    !hasAtMostDecimals(value, rule.decimals)
  );
}

function checkLine(line: unknown, index: number, problems: ErrorDetail[]) {
  const at = `lines.${index}`;
  if (!isObject(line)) return void problems.push({ field: at, code: "invalid_value" });
  const hasIngredient = line.ingredientId !== undefined && line.ingredientId !== null;
  const hasRecipe = line.recipeKey !== undefined && line.recipeKey !== null;
  if (hasIngredient === hasRecipe) problems.push({ field: at, code: "line_target_required" });

  const qty = line.qty;
  if (qty === undefined || qty === null) problems.push({ field: `${at}.qty`, code: "required" });
  else if (typeof qty !== "number") problems.push({ field: `${at}.qty`, code: "invalid_value" });
  else if (qty <= 0) problems.push({ field: `${at}.qty`, code: "qty_not_positive" });
  else if (qty > MAX_QTY || !hasAtMostDecimals(qty, 4)) {
    problems.push({ field: `${at}.qty`, code: "invalid_value" });
  }

  const factor = line.yieldFactor;
  if (factor === undefined || factor === null) return;
  const field = `${at}.yieldFactor`;
  if (typeof factor !== "number") problems.push({ field, code: "invalid_value" });
  else if (factor <= 0) problems.push({ field, code: "yield_factor_not_positive" });
  else if (factor > MAX_YIELD_FACTOR) problems.push({ field, code: "yield_factor_too_large" });
  else if (!hasAtMostDecimals(factor, 4)) problems.push({ field, code: "invalid_value" });
}

function checkNumbers(type: RecipeType, content: Loose, problems: ErrorDetail[]) {
  for (const rule of NUMERIC_RULES) {
    const value = content[rule.key];
    if (value === undefined || value === null) {
      if (rule.required.includes(type)) problems.push({ field: rule.key, code: "required" });
    } else if (!rule.types.includes(type)) {
      const code = PRICE_KEYS.has(rule.key) ? "price_not_for_type" : "field_not_for_type";
      problems.push({ field: rule.key, code });
    } else if (typeof value !== "number" || outOfRange(value, rule)) {
      problems.push({ field: rule.key, code: "invalid_value" });
    }
  }
  const { minPortions, targetPortions } = content;
  if (
    typeof minPortions === "number" &&
    typeof targetPortions === "number" &&
    targetPortions < minPortions
  ) {
    problems.push({ field: "targetPortions", code: "invalid_value" });
  }
}

/**
 * The domain rules of a recipe body for a type (M7 plan §3.1.3-4, §3.1.12): the same field codes the
 * database procedures raise. An empty list means the body is acceptable here; the references (does the
 * ingredient exist, do the units fit, is there a cycle) are checked by the database.
 */
export function validateRecipeContent(type: RecipeType, content: object): ErrorDetail[] {
  const input = content as Loose;
  const problems: ErrorDetail[] = [];

  const name = input.name;
  if (typeof name !== "string" || name.trim() === "")
    problems.push({ field: "name", code: "required" });
  else if (name.trim().length > MAX_NAME_LENGTH)
    problems.push({ field: "name", code: "invalid_value" });

  checkNumbers(type, input, problems);

  const unit = input.outputUnit;
  if (unit !== undefined && unit !== null) {
    if (type === "plate") problems.push({ field: "outputUnit", code: "field_not_for_type" });
    else if (!(OUTPUT_UNITS as readonly unknown[]).includes(unit)) {
      problems.push({ field: "outputUnit", code: "invalid_value" });
    }
  } else if (type !== "plate") problems.push({ field: "outputUnit", code: "required" });

  const lines = input.lines;
  if (!Array.isArray(lines) || lines.length === 0)
    problems.push({ field: "lines", code: "no_lines" });
  else if (lines.length > MAX_RECIPE_LINES)
    problems.push({ field: "lines", code: "too_many_lines" });
  else lines.forEach((line, index) => checkLine(line, index, problems));
  return problems;
}

/** Throws the 422 `recipe_invalid` the screen shows field by field; the message is generic. */
export function assertValidRecipeContent(type: RecipeType, content: object): void {
  const problems = validateRecipeContent(type, content);
  if (problems.length > 0) {
    throw new ApiError(422, "recipe_invalid", t("recipeError.recipe_invalid"), problems);
  }
}

export const keyParams = z.object({ key: z.uuid() });
export const versionParams = z.object({
  key: z.uuid(),
  version: z
    .string()
    .regex(/^[1-9]\d{0,8}$/)
    .transform(Number),
});
