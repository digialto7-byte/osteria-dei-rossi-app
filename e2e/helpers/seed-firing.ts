import { expect, type Page } from "@playwright/test";
import { seedOrderCatalogue, type OrderCatalogue } from "./seed-order";

// Fixtures of the firing and kitchen specs (M19 plan §5 step 19), fake data only. They build on the order catalogue of M18
// (two plates that use one portion of the stew and the ragù, four dishes with no recipe, stew batch of 3 portions) and add
// ONE ragù batch of 4 portions, made through the production route as the signed-in owner, so "Tagliatelle al ragù (demo)" has
// 4 portions: after two are sent the screen says "Ne restano 2".

export const RAGU_PORTIONS = 4;

export async function seedFiringCatalogue(page: Page, tenantId: string): Promise<OrderCatalogue> {
  const catalogue = await seedOrderCatalogue(page, tenantId);
  const proposal = await page.request.get(`/api/batches/proposal?recipeKey=${catalogue.raguKey}`);
  expect(proposal.status()).toBe(200);
  const raguVersion = ((await proposal.json()) as { recipe: { id: string } }).recipe.id;
  // 0,8 kg of the 2 kg / 10 portion ragù is 4 portions.
  const made = await page.request.post("/api/batches", {
    data: {
      recipeId: raguVersion,
      outputQty: 0.8,
      portions: RAGU_PORTIONS,
      locationId: catalogue.cellaId,
      inputs: [
        { ingredientId: catalogue.beefId, qty: 0.8, unit: "kg", locationId: catalogue.cellaId },
      ],
    },
  });
  expect(made.status(), await made.text()).toBe(201);
  return catalogue;
}
