import { z } from "zod";
import {
  RULES_LEAD_TIME_MAX,
  RULES_LEVEL_DECIMALS,
  RULES_LEVEL_MAX,
  RULES_PORTIONS_MAX,
  RULES_PREP_TIME_MAX,
} from "./constants";

// Strict PATCH bodies of the rules endpoints (M16 plan §3.4). A key that is absent is left alone; JSON null clears the
// rule. The bounds mirror the SQL procedures, which stay the authority: the schema only turns the obvious mistakes
// into a 400 before any RPC. The bodies are passed to the procedures as the patch, key for key.

const level = z
  .number()
  .finite()
  .min(0)
  .max(RULES_LEVEL_MAX)
  .refine(
    (v) => {
      const scale = 10 ** RULES_LEVEL_DECIMALS;
      return Math.abs(v * scale - Math.round(v * scale)) < 1e-6;
    },
    { message: `at most ${RULES_LEVEL_DECIMALS} decimals` },
  )
  .nullable();

const wholeNumber = (max: number) => z.number().int().min(0).max(max);

const weekdays = z
  .array(z.number().int().min(1).max(7))
  .max(7)
  .refine((days) => new Set(days).size === days.length, { message: "duplicate weekday" });

const cutoff = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .nullable();

const atLeastOne = (keys: string[]) => (body: Record<string, unknown>) =>
  keys.some((key) => key in body && body[key] !== undefined);

export const ingredientRulesBody = z
  .strictObject({
    ingredientId: z.uuid(),
    minLevel: level.optional(),
    targetLevel: level.optional(),
    preferredSupplierItemId: z.uuid().nullable().optional(),
  })
  .refine(atLeastOne(["minLevel", "targetLevel", "preferredSupplierItemId"]), {
    message: "nothing to change",
  });

export const supplierRulesBody = z
  .strictObject({
    supplierId: z.uuid(),
    leadTimeDays: wholeNumber(RULES_LEAD_TIME_MAX).nullable().optional(),
    deliveryWeekdays: weekdays.optional(),
    orderCutoffTime: cutoff.optional(),
  })
  .refine(atLeastOne(["leadTimeDays", "deliveryWeekdays", "orderCutoffTime"]), {
    message: "nothing to change",
  });

export const recipeRulesBody = z
  .strictObject({
    recipeKey: z.uuid(),
    minPortions: wholeNumber(RULES_PORTIONS_MAX).nullable().optional(),
    targetPortions: wholeNumber(RULES_PORTIONS_MAX).nullable().optional(),
    prepTimeMin: wholeNumber(RULES_PREP_TIME_MAX).nullable().optional(),
  })
  .refine(atLeastOne(["minPortions", "targetPortions", "prepTimeMin"]), {
    message: "nothing to change",
  });

export type IngredientRulesBody = z.infer<typeof ingredientRulesBody>;
export type SupplierRulesBody = z.infer<typeof supplierRulesBody>;
export type RecipeRulesBody = z.infer<typeof recipeRulesBody>;
