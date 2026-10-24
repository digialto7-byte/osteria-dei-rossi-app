import { z } from "zod";

// Strict output schemas of the staff-meal endpoints (M15 plan §3.4). Quantities and names only: the chef reads all
// of them, so no key is a value, a cost or a price (Q16 = project V6). An undeclared key makes the parse throw.

const kind = z.enum(["recipe", "ingredient"]);

export const staffMealRules = z.strictObject({
  businessDate: z.string(),
  rules: z.array(
    z.strictObject({
      ruleId: z.uuid(),
      kind,
      targetId: z.uuid(),
      name: z.string(),
      unit: z.string(),
      defaultCount: z.number(),
      locationId: z.uuid().nullable(),
      isActive: z.boolean(),
      available: z.number().nullable(),
      today: z
        .strictObject({
          confirmationId: z.uuid(),
          count: z.number(),
          at: z.string(),
          byInitials: z.string(),
        })
        .nullable(),
    }),
  ),
});

export const staffMealRule = z.strictObject({
  ruleId: z.uuid(),
  kind,
  targetId: z.uuid(),
  defaultCount: z.number(),
  locationId: z.uuid().nullable(),
  isActive: z.boolean(),
});

export const staffMealConfirmation = z.strictObject({
  confirmationId: z.uuid(),
  ruleId: z.uuid(),
  businessDate: z.string(),
  count: z.number(),
  movements: z.array(
    z.union([
      z.strictObject({ batchId: z.uuid(), portions: z.number() }),
      z.strictObject({ ingredientId: z.uuid(), qty: z.number() }),
    ]),
  ),
  negatives: z.array(
    z.strictObject({ ingredientId: z.uuid(), locationId: z.uuid(), onHandQty: z.number() }),
  ),
});
