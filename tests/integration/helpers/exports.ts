import type { ReportsFixture } from "./reports";

// Fixtures of the exports suite (M24 plan §3.8, §5 step 12), fake data only. The suite builds on the M22 reports tenant (./reports): on top of it, one
// closed sale of an item whose name starts with "=" (the formula-injection case, T4), a batch recipe with a 20-hour shelf life (so a batch falls due
// within the push list's 24 hours), two batches of it, and one portion of the second thrown away (waste in euro and a row of "discards against push").

export const EXPORT_NAMES = {
  formulaItem: "=1+1 (demo)",
  sugo: "Sugo rapido (demo)",
} as const;

/** POST /api/menu/items: an item with no recipe, so it also lands in the unmapped report. */
export const FORMULA_ITEM_BODY = {
  name: EXPORT_NAMES.formulaItem,
  category: "Bevande",
  course: "bevande",
  recipeKey: null,
  price: 5,
  vatRate: 10,
} as const;

/** POST /api/recipes: a batch recipe, 2 kg out for 1 kg of beef, 10 portions, 20 hours of shelf life. */
export function sugoRecipeBody(fixture: Pick<ReportsFixture, "beefId">) {
  return {
    type: "batch",
    name: EXPORT_NAMES.sugo,
    outputQty: 2,
    outputUnit: "kg",
    portionsPerBatch: 10,
    shelfLifeHours: 20,
    lines: [{ ingredientId: fixture.beefId, qty: 1, unit: "kg" }],
  };
}

/** POST /api/batches: 0,4 kg of the sugo (2 portions) from 0,2 kg of beef. */
export function sugoBatchBody(
  fixture: Pick<ReportsFixture, "beefId" | "cellaId">,
  versionId: string,
) {
  return {
    recipeId: versionId,
    outputQty: 0.4,
    locationId: fixture.cellaId,
    inputs: [{ ingredientId: fixture.beefId, qty: 0.2, unit: "kg", locationId: fixture.cellaId }],
  };
}
