import type { SupabaseClient } from "@supabase/supabase-js";
import { expect } from "vitest";
import { seedBatchFixture, seedRaguBatch, seedRaguRecipe, type BatchFixture } from "./batches";
import { approveWithLots } from "./invoices";
import type { OrderCalls } from "./orders";
import { createUser, type Stack, type TestTenant, type TestUser } from "./stack";

// Fixtures of the firing suite (M19 plan §5 step 15), fake data only. Everything the app can do goes through the routes:
// recipes, batches (the production route), menu items. The secret key creates the second location, the second waiter and
// the polenta and bread ingredients; it never reads `recipe` or `recipe_key` (no grant, lesson 3). The tenant has TWO
// locations on purpose (lesson 1: the fire may take raw stock from either) and two waiters.
//
//   stew batch A: 3 portions, shelf life 24 h (expires first)        ragù batch: 10 portions
//   stew batch B: 5 portions, shelf life 48 h
//   polenta: lot P2 0,10 kg at Cella (expires D+8), lot P1 1 kg at Dispensa (D+10), 1,20 EUR/kg
//   pane: lot N1 5 kg at Dispensa (D+9), 3,00 EUR/kg
//   plate "Spezzatino con polenta (demo)" = 1 porz stew + 150 g polenta + 50 g pane (yield 0,5)
//   plate "Tagliatelle al ragù (demo)" = 1 porz ragù

export interface FiringFixture {
  batch: BatchFixture;
  dispensaId: string;
  waiter2: TestUser;
  polentaId: string;
  paneId: string;
  stewBatchA: string;
  stewBatchB: string;
  raguBatchId: string;
  /** Menu item ids by name: two mapped dishes and two unmapped ones. */
  items: { stew: string; tagliatelle: string; zuppa: string; acqua: string };
}

export const FIRING_NAMES = {
  stew: "Spezzatino con polenta (demo)",
  tagliatelle: "Tagliatelle al ragù (demo)",
  zuppa: "Zuppa del giorno (demo)",
  acqua: "Acqua (demo)",
} as const;

export async function seedFiringTenant(
  stack: Stack,
  tenant: TestTenant,
  calls: OrderCalls,
): Promise<FiringFixture> {
  const db: SupabaseClient = stack.admin;
  const batch = await seedBatchFixture(db, tenant.id, calls);
  const dispensa = await db
    .from("location")
    .insert({ tenant_id: tenant.id, name: "Dispensa (demo)" })
    .select("id")
    .single();
  expect(dispensa.error).toBeNull();
  const dispensaId = dispensa.data!.id as string;

  const made = await db
    .from("ingredient")
    .insert([
      { tenant_id: tenant.id, name: "Polenta (demo)", base_unit: "kg", is_stock: true },
      { tenant_id: tenant.id, name: "Pane (demo)", base_unit: "kg", is_stock: true },
    ])
    .select("id, name");
  expect(made.error).toBeNull();
  const byName = new Map((made.data ?? []).map((row) => [row.name as string, row.id as string]));
  const polentaId = byName.get("Polenta (demo)")!;
  const paneId = byName.get("Pane (demo)")!;

  // The lots arrive the production way: invoices with lot codes and expiries, approved through the approve route.
  const arrive = async (
    locationId: string,
    line: {
      description: string;
      ingredientId: string;
      qty: number;
      unitPrice: number;
      lotCode: string;
      expiry: string;
    },
  ) => {
    const approved = await approveWithLots(
      db,
      tenant.id,
      { supplierId: batch.supplierId, date: calls.day(-1), lines: [{ ...line, unit: "kg" }] },
      (invoiceId) => calls.approve(invoiceId, locationId),
    );
    expect(approved.status).toBe(200);
  };
  await arrive(batch.cellaId, {
    description: "Polenta P2",
    ingredientId: polentaId,
    qty: 0.1,
    unitPrice: 1.2,
    lotCode: "P2",
    expiry: calls.day(8),
  });
  await arrive(dispensaId, {
    description: "Polenta P1",
    ingredientId: polentaId,
    qty: 1,
    unitPrice: 1.2,
    lotCode: "P1",
    expiry: calls.day(10),
  });
  await arrive(dispensaId, {
    description: "Pane N1",
    ingredientId: paneId,
    qty: 5,
    unitPrice: 3,
    lotCode: "N1",
    expiry: calls.day(9),
  });

  const raguKey = await seedRaguRecipe(batch, calls);
  const stewVersion = await calls.versionOf(batch.stewKey);
  const raguVersion = await calls.versionOf(raguKey);

  // 0,6 kg of the 6 kg / 30 portion stew is 3 portions (24 h); 1 kg is 5 portions (48 h).
  const stewA = await calls.produce({
    recipeId: stewVersion,
    outputQty: 0.6,
    portions: 3,
    shelfLifeHours: 24,
    locationId: batch.cellaId,
    inputs: [
      { ingredientId: batch.beefId, qty: 0.5, unit: "kg", locationId: batch.cellaId },
      { ingredientId: batch.onionId, qty: 0.03, unit: "kg", locationId: batch.cellaId },
      { ingredientId: batch.carrotId, qty: 0.02, unit: "kg", locationId: batch.cellaId },
    ],
  });
  expect(stewA.status).toBe(201);
  expect(stewA.body.portions).toBe(3);
  const stewB = await calls.produce({
    recipeId: stewVersion,
    outputQty: 1,
    portions: 5,
    shelfLifeHours: 48,
    locationId: batch.cellaId,
    inputs: [
      { ingredientId: batch.beefId, qty: 0.8, unit: "kg", locationId: batch.cellaId },
      { ingredientId: batch.onionId, qty: 0.05, unit: "kg", locationId: batch.cellaId },
      { ingredientId: batch.carrotId, qty: 0.03, unit: "kg", locationId: batch.cellaId },
    ],
  });
  expect(stewB.status).toBe(201);
  expect(stewB.body.portions).toBe(5);
  const ragu = await seedRaguBatch(batch.beefId, raguVersion, batch.cellaId, calls.produce);

  const stewPlate = await calls.createRecipe({
    type: "plate",
    name: "Spezzatino con polenta (piatto)",
    salePrice: 14,
    targetGpPct: 70,
    lines: [
      { recipeKey: batch.stewKey, qty: 1, unit: "porz" },
      { ingredientId: polentaId, qty: 150, unit: "g" },
      { ingredientId: paneId, qty: 50, unit: "g", yieldFactor: 0.5 },
    ],
  });
  expect(stewPlate.status).toBe(201);
  const raguPlate = await calls.createRecipe({
    type: "plate",
    name: "Tagliatelle al ragù (piatto)",
    salePrice: 11,
    targetGpPct: 70,
    lines: [{ recipeKey: raguKey, qty: 1, unit: "porz" }],
  });
  expect(raguPlate.status).toBe(201);

  const item = async (body: {
    name: string;
    category: string;
    course: string;
    recipeKey: string | null;
    price: number;
  }) => {
    const created = await calls.createItem({ ...body, vatRate: 10 });
    expect(created.status).toBe(201);
    return created.body.item.id;
  };
  const items = {
    stew: await item({
      name: FIRING_NAMES.stew,
      category: "Secondi",
      course: "secondi",
      recipeKey: stewPlate.body.recipe.key,
      price: 14,
    }),
    tagliatelle: await item({
      name: FIRING_NAMES.tagliatelle,
      category: "Primi",
      course: "primi",
      recipeKey: raguPlate.body.recipe.key,
      price: 11,
    }),
    zuppa: await item({
      name: FIRING_NAMES.zuppa,
      category: "Primi",
      course: "primi",
      recipeKey: null,
      price: 9,
    }),
    acqua: await item({
      name: FIRING_NAMES.acqua,
      category: "Bevande",
      course: "bevande",
      recipeKey: null,
      price: 2,
    }),
  };

  return {
    batch,
    dispensaId,
    waiter2: await createUser(stack.env, db, tenant.id, "waiter", "Cameriere Due Demo"),
    polentaId,
    paneId,
    stewBatchA: stewA.body.batchId,
    stewBatchB: stewB.body.batchId,
    raguBatchId: ragu.batchId,
    items,
  };
}
