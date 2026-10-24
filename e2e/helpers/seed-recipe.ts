import { expect, type Page } from "@playwright/test";

// The owner creates the batch recipe through the real API (the session of `page`), as a user would on /ricette/nuova:
// "Spezzatino (demo)", 6 kg, 30 portions, 72 hours, 5 kg of beef. Fake data only.

export const STEW = "Spezzatino (demo)";

/** Creates the stew as the signed-in owner and returns its recipe key. */
export async function seedStewRecipe(page: Page, beefId: string): Promise<string> {
  const created = await page.request.post("/api/recipes", {
    data: {
      type: "batch",
      name: STEW,
      outputQty: 6,
      outputUnit: "kg",
      portionsPerBatch: 30,
      shelfLifeHours: 72,
      lines: [{ ingredientId: beefId, qty: 5, unit: "kg" }],
    },
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { recipe: { key: string } }).recipe.key;
}

// M15: the second batch recipe, "Ragù (demo)": 2 kg, 10 portions, 48 hours, 2 kg of beef. With the beef at 10,00 EUR/kg
// one batch costs 20,00 EUR, 2,00 EUR a portion.

export const RAGU = "Ragù (demo)";

/** Creates the Ragù as the signed-in owner and returns its recipe key. */
export async function seedRaguRecipe(page: Page, beefId: string): Promise<string> {
  const created = await page.request.post("/api/recipes", {
    data: {
      type: "batch",
      name: RAGU,
      outputQty: 2,
      outputUnit: "kg",
      portionsPerBatch: 10,
      shelfLifeHours: 48,
      lines: [{ ingredientId: beefId, qty: 2, unit: "kg" }],
    },
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { recipe: { key: string } }).recipe.key;
}
