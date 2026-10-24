import { z } from "zod";
import { STOCK_INPUT_UNITS } from "@/server/stock/constants";
import { STAFF_MEAL_COUNT_MAX } from "./constants";

// At most 4 decimals, the precision of the ledgers (the same tolerance as the batch and stock schemas).
function hasAtMost4Decimals(value: number): boolean {
  const scaled = value * 10_000;
  return Math.abs(scaled - Math.round(scaled)) <= 1e-6;
}

const count4 = z
  .number()
  .positive()
  .max(STAFF_MEAL_COUNT_MAX)
  .refine(hasAtMost4Decimals, "at most 4 decimals");

/**
 * POST /api/staff-meals: a rule for a batch recipe (portions) or for a stock ingredient (a quantity in `unit`).
 * Exactly one target: the union of two strict objects refuses both and neither. The target's type, the unit and the
 * location are checked in SQL.
 */
export const ruleBody = z.union([
  z.strictObject({
    recipeKey: z.uuid(),
    defaultCount: count4,
    isActive: z.boolean().optional(),
  }),
  z.strictObject({
    ingredientId: z.uuid(),
    defaultCount: count4,
    unit: z.enum(STOCK_INPUT_UNITS),
    locationId: z.uuid().optional(),
    isActive: z.boolean().optional(),
  }),
]);

/** POST /api/staff-meals/:id/confirm: no count means the rule's default. */
export const confirmBody = z.strictObject({ count: count4.optional() });

export type RuleBody = z.infer<typeof ruleBody>;
export type ConfirmBody = z.infer<typeof confirmBody>;
