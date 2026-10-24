import { z } from "zod";

// Strict output schemas of the rules endpoints (M16 plan §3.4). The services parse every database reply here, so a
// column that is not declared (a price that slipped into an RPC reply, say) makes the parse throw: a 500, never a
// leak. No schema declares an EUR, cost, price, margin or amount key; the tests walk the shapes to prove it.
// The chef's ingredient shape has no supplierItems.

const baseUnit = z.enum(["kg", "l", "pz"]);
const window = z.strictObject({ deliveryDate: z.string(), orderByAt: z.string() });
const source = z.enum(["rule", "version"]).nullable();

export const ingredientRulesItem = z.strictObject({
  ingredientId: z.uuid(),
  name: z.string(),
  baseUnit,
  isCritical: z.boolean(),
  minLevel: z.number().nullable(),
  targetLevel: z.number().nullable(),
  onHandQty: z.number(),
  preferred: z
    .strictObject({
      supplierItemId: z.uuid(),
      supplierId: z.uuid(),
      supplierName: z.string(),
      packQty: z.number(),
      packLabel: z.string(),
    })
    .nullable(),
  nextWindow: window.nullable(),
  status: z.enum(["ok", "incomplete", "off"]),
  reasons: z.array(z.string()),
});

const supplierItemChoice = z.strictObject({
  supplierItemId: z.uuid(),
  ingredientId: z.uuid(),
  supplierId: z.uuid(),
  supplierName: z.string(),
  packQty: z.number(),
  packLabel: z.string(),
});

export const ingredientRulesChefResponse = z.strictObject({
  today: z.string(),
  items: z.array(ingredientRulesItem),
});

export const ingredientRulesResponse = ingredientRulesChefResponse.extend({
  supplierItems: z.array(supplierItemChoice),
});

export const supplierRulesItem = z.strictObject({
  supplierId: z.uuid(),
  name: z.string(),
  leadTimeDays: z.number().int().nullable(),
  deliveryWeekdays: z.array(z.number().int()),
  orderCutoffTime: z.string().nullable(),
  nextWindow: window.nullable(),
});

export const supplierRulesResponse = z.strictObject({ items: z.array(supplierRulesItem) });

export const recipeRulesItem = z.strictObject({
  recipeKey: z.uuid(),
  name: z.string(),
  version: z.number().int(),
  portionsPerBatch: z.number(),
  minPortions: z.number().int().nullable(),
  targetPortions: z.number().int().nullable(),
  prepTimeMin: z.number().int().nullable(),
  sources: z.strictObject({ min: source, target: source, prep: source }),
  remainingPortions: z.number(),
});

export const recipeRulesResponse = z.strictObject({ items: z.array(recipeRulesItem) });

// The replies of the three write procedures.
export const ingredientRulesChange = z.strictObject({
  ingredientId: z.uuid(),
  changed: z.boolean(),
  minLevel: z.number().nullable(),
  targetLevel: z.number().nullable(),
  preferredSupplierItemId: z.uuid().nullable(),
});

export const supplierRulesChange = z.strictObject({
  supplierId: z.uuid(),
  changed: z.boolean(),
  leadTimeDays: z.number().int().nullable(),
  deliveryWeekdays: z.array(z.number().int()),
  orderCutoffTime: z.string().nullable(),
});

export const recipeRulesChange = z.strictObject({
  recipeKey: z.uuid(),
  changed: z.boolean(),
  minPortions: z.number().int().nullable(),
  targetPortions: z.number().int().nullable(),
  prepTimeMin: z.number().int().nullable(),
  sources: z.strictObject({ min: source, target: source, prep: source }),
});

export type IngredientRulesItem = z.infer<typeof ingredientRulesItem>;
// The answers of the PATCH endpoints: the procedure's verdict and the item as a follow-up read shows it (null when
// the read does not list it, e.g. an inactive record).
export const ingredientRulesPatchResponse = z.strictObject({
  ingredientId: z.uuid(),
  changed: z.boolean(),
  item: ingredientRulesItem.nullable(),
});
export const supplierRulesPatchResponse = z.strictObject({
  supplierId: z.uuid(),
  changed: z.boolean(),
  item: supplierRulesItem.nullable(),
});
export const recipeRulesPatchResponse = z.strictObject({
  recipeKey: z.uuid(),
  changed: z.boolean(),
  item: recipeRulesItem.nullable(),
});

export type IngredientRulesResponse = z.infer<typeof ingredientRulesResponse>;
export type SupplierRulesItem = z.infer<typeof supplierRulesItem>;
export type RecipeRulesItem = z.infer<typeof recipeRulesItem>;
