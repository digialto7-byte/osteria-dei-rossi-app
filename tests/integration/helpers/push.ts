import { expect } from "vitest";
import { approveWithLots } from "./invoices";
import type { OrderCalls, OrderFixture } from "./orders";
import type { Stack, TestTenant } from "./stack";

// Fixtures of the push and forecast suite (M23 plan §5 step 13), fake data only. Everything the app can do goes through the routes: the recipes, the
// invoice with two lots (approved through the approve route), the batch (the production route), the waste, the menu item. The secret key creates
// the ingredient only. The server clock cannot be moved here, so the batches and lots are made to fall due within a day of now: a batch recipe with a
// shelf life of 20 hours, and lots that expire on the business date plus one (`calls.day(1)`, which the suite derives from the business date, not the calendar date).

export interface PushCalls extends OrderCalls {
  /** POST /api/stock/waste as the chef. Resolves to the HTTP status. */
  wasteLot: (body: object) => Promise<number>;
}

export interface PushFixture {
  parmigianoId: string;
  /** Lot "PM-FULL": 1 kg, expires on the business date plus one, wasted down to 0 kg. Lot "PM-LIVE": 2 kg, expires on the business date plus one. */
  lotFullId: string;
  lotLiveId: string;
  /** The batch recipe "Sugo rapido (demo)" (shelf life 20 h, 10 portions per 2 kg) and its current version. */
  sugoKey: string;
  sugoVersionId: string;
  /** The first batch: 2 portions, to be sold out. */
  soldBatchId: string;
  /** The plate "Pasta al sugo" (1 portion of the sugo and 0,02 kg of Parmigiano) and its menu item at 9,00 €. */
  pastaPlateKey: string;
  pastaItemId: string;
}

export const PUSH_NAMES = {
  sugo: "Sugo rapido (demo)",
  pasta: "Pasta al sugo (demo)",
  parmigiano: "Parmigiano (demo)",
} as const;

/** Produces `outputQty` kg of the sugo (the recipe is 2 kg for 10 portions from 1 kg of beef) at Cella. */
export async function produceSugo(
  fixture: Pick<PushFixture, "sugoVersionId">,
  order: Pick<OrderFixture, "batch">,
  calls: Pick<PushCalls, "produce">,
  outputQty: number,
): Promise<string> {
  const made = await calls.produce({
    recipeId: fixture.sugoVersionId,
    outputQty,
    locationId: order.batch.cellaId,
    inputs: [
      {
        ingredientId: order.batch.beefId,
        qty: outputQty / 2,
        unit: "kg",
        locationId: order.batch.cellaId,
      },
    ],
  });
  expect(made.status).toBe(201);
  return made.body.batchId;
}

/**
 * Builds on tenant A's order fixture: Parmigiano with two lots expiring on the business date plus one (one then wasted to 0 kg), the 20-hour sugo recipe, one sugo batch of
 * 2 portions, the pasta plate and its menu item.
 */
export async function seedPushFixture(
  stack: Stack,
  tenant: TestTenant,
  order: OrderFixture,
  calls: PushCalls,
): Promise<PushFixture> {
  const db = stack.admin;
  const parm = await db
    .from("ingredient")
    .insert({ tenant_id: tenant.id, name: PUSH_NAMES.parmigiano, base_unit: "kg", is_stock: true })
    .select("id")
    .single();
  expect(parm.error).toBeNull();
  const parmigianoId = parm.data!.id as string;

  const approved = await approveWithLots(
    db,
    tenant.id,
    {
      supplierId: order.batch.supplierId,
      date: calls.day(-1),
      lines: [
        {
          description: "Parmigiano PM-FULL",
          ingredientId: parmigianoId,
          qty: 1,
          unit: "kg",
          unitPrice: 20,
          lotCode: "PM-FULL",
          expiry: calls.day(1),
        },
        {
          description: "Parmigiano PM-LIVE",
          ingredientId: parmigianoId,
          qty: 2,
          unit: "kg",
          unitPrice: 20,
          lotCode: "PM-LIVE",
          expiry: calls.day(1),
        },
      ],
    },
    (invoiceId) => calls.approve(invoiceId, order.batch.cellaId),
  );
  expect(approved.status).toBe(200);

  const lots = await tenant.owner.client
    .from("raw_lot")
    .select("id, lot_code")
    .in("lot_code", ["PM-FULL", "PM-LIVE"]);
  expect(lots.error).toBeNull();
  const lotId = (code: string) => (lots.data ?? []).find((l) => l.lot_code === code)!.id as string;
  const lotFullId = lotId("PM-FULL");
  const lotLiveId = lotId("PM-LIVE");
  // Whole lot out, by id (no FEFO guess): the push list must not offer a lot at 0 kg.
  expect(
    await calls.wasteLot({
      ingredientId: parmigianoId,
      qty: 1,
      unit: "kg",
      reason: "spoilage",
      locationId: order.batch.cellaId,
      lotId: lotFullId,
    }),
  ).toBe(201);

  const sugo = await calls.createRecipe({
    type: "batch",
    name: PUSH_NAMES.sugo,
    outputQty: 2,
    outputUnit: "kg",
    portionsPerBatch: 10,
    shelfLifeHours: 20,
    lines: [{ ingredientId: order.batch.beefId, qty: 1, unit: "kg" }],
  });
  expect(sugo.status).toBe(201);
  const sugoKey = sugo.body.recipe.key;
  const sugoVersionId = await calls.versionOf(sugoKey);
  const soldBatchId = await produceSugo({ sugoVersionId }, order, calls, 0.4);

  const plate = await calls.createRecipe({
    type: "plate",
    name: `${PUSH_NAMES.pasta} (piatto)`,
    salePrice: 9,
    targetGpPct: 70,
    lines: [
      { recipeKey: sugoKey, qty: 1, unit: "porz" },
      { ingredientId: parmigianoId, qty: 0.02, unit: "kg" },
    ],
  });
  expect(plate.status).toBe(201);
  const pastaPlateKey = plate.body.recipe.key;
  const item = await calls.createItem({
    name: PUSH_NAMES.pasta,
    category: "Primi",
    course: "primi",
    recipeKey: pastaPlateKey,
    price: 9,
    vatRate: 10,
  });
  expect(item.status).toBe(201);

  return {
    parmigianoId,
    lotFullId,
    lotLiveId,
    sugoKey,
    sugoVersionId,
    soldBatchId,
    pastaPlateKey,
    pastaItemId: item.body.item.id,
  };
}
