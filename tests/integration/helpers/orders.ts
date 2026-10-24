import type { SupabaseClient } from "@supabase/supabase-js";
import { expect } from "vitest";
import { seedBatchFixture, seedRaguBatch, seedRaguRecipe, type BatchFixture } from "./batches";
import type { FixtureCalls } from "./batches";
import { createUser, type Stack, type TestTenant, type TestUser } from "./stack";

// Fixtures of the order entry suite (M18 plan §3.8), fake data only. Everything the app can do goes through the
// routes: recipes, batches (the production route), menu items. The secret key creates the second location, the
// second waiter and counts order lines; it never reads `recipe` or `recipe_key` (no grant, lesson 3). The tenant has
// TWO locations on purpose (lesson 1: nothing in M18 may depend on there being one) and two waiters.

export interface OrderCalls extends FixtureCalls {
  /** GET /api/batches/proposal as the chef: the id of the recipe's current version. */
  versionOf: (recipeKey: string) => Promise<string>;
  /** POST /api/batches as the chef. */
  produce: (body: object) => Promise<{
    status: number;
    body: { batchId: string; lotCode: string; portions: number };
  }>;
  /** POST /api/menu/items as the owner. */
  createItem: (body: object) => Promise<{ status: number; body: { item: { id: string } } }>;
}

export interface OrderFixture {
  batch: BatchFixture;
  dispensaId: string;
  /** "Cameriere Due Demo": a second waiter of the same tenant. */
  waiter2: TestUser;
  /** The stew batch (3 portions) and the ragù batch (10 portions) behind the two mapped dishes. */
  stewBatchId: string;
  raguBatchId: string;
  /** Menu item ids by name. */
  items: {
    stew: string;
    tagliatelle: string;
    bruschetta: string;
    zuppa: string;
    tiramisu: string;
    acqua: string;
  };
}

export const NAMES = {
  stew: "Spezzatino con polenta (demo)",
  tagliatelle: "Tagliatelle al ragù (demo)",
  bruschetta: "Bruschetta (demo)",
  zuppa: "Zuppa del giorno (demo)",
  tiramisu: "Tiramisù (demo)",
  acqua: "Acqua (demo)",
} as const;

/**
 * Tenant A's order fixture: the batch fixture (Cella, beef lots, the stew batch recipe), a second location, the ragù
 * recipe, one stew batch of 3 portions and one ragù batch of 10, two plates that use one portion of each, and the six
 * menu items of the plan (two mapped, four unmapped).
 */
export async function seedOrderTenant(
  stack: Stack,
  tenant: TestTenant,
  calls: OrderCalls,
): Promise<OrderFixture> {
  const db: SupabaseClient = stack.admin;
  const batch = await seedBatchFixture(db, tenant.id, calls);
  const dispensa = await db
    .from("location")
    .insert({ tenant_id: tenant.id, name: "Dispensa (demo)" })
    .select("id")
    .single();
  expect(dispensa.error).toBeNull();

  const raguKey = await seedRaguRecipe(batch, calls);
  const stewVersion = await calls.versionOf(batch.stewKey);
  const raguVersion = await calls.versionOf(raguKey);

  // 0,6 kg of a 6 kg / 30 portion recipe is 3 portions: the plan's "Ne restano 3".
  const stew = await calls.produce({
    recipeId: stewVersion,
    outputQty: 0.6,
    portions: 3,
    locationId: batch.cellaId,
    inputs: [
      { ingredientId: batch.beefId, qty: 0.5, unit: "kg", locationId: batch.cellaId },
      { ingredientId: batch.onionId, qty: 0.03, unit: "kg", locationId: batch.cellaId },
      { ingredientId: batch.carrotId, qty: 0.02, unit: "kg", locationId: batch.cellaId },
    ],
  });
  expect(stew.status).toBe(201);
  expect(stew.body.portions).toBe(3);
  const ragu = await seedRaguBatch(batch.beefId, raguVersion, batch.cellaId, calls.produce);

  const plate = async (name: string, batchKey: string) => {
    const made = await calls.createRecipe({
      type: "plate",
      name: `${name} (piatto)`,
      salePrice: 12,
      targetGpPct: 70,
      lines: [{ recipeKey: batchKey, qty: 1, unit: "porz" }],
    });
    expect(made.status).toBe(201);
    return made.body.recipe.key;
  };
  const stewPlate = await plate("Spezzatino con polenta (demo)", batch.stewKey);
  const raguPlate = await plate("Tagliatelle al ragù (demo)", raguKey);

  const item = async (body: {
    name: string;
    category: string;
    course: string;
    recipeKey: string | null;
    price: number;
  }) => {
    const made = await calls.createItem({ ...body, vatRate: 10 });
    expect(made.status).toBe(201);
    return made.body.item.id;
  };
  const items = {
    stew: await item({
      name: NAMES.stew,
      category: "Secondi",
      course: "secondi",
      recipeKey: stewPlate,
      price: 14,
    }),
    tagliatelle: await item({
      name: NAMES.tagliatelle,
      category: "Primi",
      course: "primi",
      recipeKey: raguPlate,
      price: 11,
    }),
    bruschetta: await item({
      name: NAMES.bruschetta,
      category: "Antipasti",
      course: "antipasti",
      recipeKey: null,
      price: 5,
    }),
    zuppa: await item({
      name: NAMES.zuppa,
      category: "Primi",
      course: "primi",
      recipeKey: null,
      price: 9,
    }),
    tiramisu: await item({
      name: NAMES.tiramisu,
      category: "Dolci",
      course: "dolci",
      recipeKey: null,
      price: 6,
    }),
    acqua: await item({
      name: NAMES.acqua,
      category: "Bevande",
      course: "bevande",
      recipeKey: null,
      price: 2,
    }),
  };

  return {
    batch,
    dispensaId: dispensa.data!.id as string,
    waiter2: await createUser(stack.env, db, tenant.id, "waiter", "Cameriere Due Demo"),
    stewBatchId: stew.body.batchId,
    raguBatchId: ragu.batchId,
    items,
  };
}
