import type { SupabaseClient } from "@supabase/supabase-js";
import { expect } from "vitest";
import { approveWithLots, seedLocation, seedSupplier } from "./invoices";

// Fixtures of the batch suite (M14 plan §3.8), fake data only. Recipes are created through the owner's API and the
// lots arrive the production way (an invoice with lot codes and expiries, approved through the approve route), so the
// suite proves the whole chain. The functions take the route calls as arguments: this file knows no route.

export interface BatchFixture {
  supplierId: string;
  cellaId: string;
  beefId: string;
  onionId: string;
  carrotId: string;
  saltId: string;
  waterId: string;
  soffrittoKey: string;
  stewKey: string;
  brodoKey: string;
}

type Made = { status: number; body: { recipe: { key: string } } };
export interface FixtureCalls {
  /** POST /api/recipes as the owner. */
  createRecipe: (body: object) => Promise<Made>;
  /** POST /api/invoices/:id/approve as the owner, into Cella; resolves to the HTTP status. */
  approve: (invoiceId: string, locationId: string) => Promise<number>;
  /** The Rome date `offset` days from today, as YYYY-MM-DD. */
  day: (offset: number) => string;
}

/** The batch recipes: a soffritto sub, the stew (6 kg, 30 portions, 72 h) and a brodo with an unpriced salt. */
export async function seedStewRecipe(
  ids: Pick<BatchFixture, "beefId" | "onionId" | "carrotId" | "saltId" | "waterId">,
  calls: Pick<FixtureCalls, "createRecipe">,
): Promise<Pick<BatchFixture, "soffrittoKey" | "stewKey" | "brodoKey">> {
  const sub = await calls.createRecipe({
    type: "sub",
    name: "Soffritto (demo)",
    outputQty: 1,
    outputUnit: "kg",
    lines: [
      { ingredientId: ids.onionId, qty: 0.6, unit: "kg" },
      { ingredientId: ids.carrotId, qty: 0.4, unit: "kg" },
    ],
  });
  expect(sub.status).toBe(201);
  const stew = await calls.createRecipe({
    type: "batch",
    name: "Spezzatino (demo)",
    outputQty: 6,
    outputUnit: "kg",
    portionsPerBatch: 30,
    shelfLifeHours: 72,
    lines: [
      { ingredientId: ids.beefId, qty: 5, unit: "kg" },
      { recipeKey: sub.body.recipe.key, qty: 0.5, unit: "kg" },
      { ingredientId: ids.waterId, qty: 1, unit: "l" },
    ],
  });
  expect(stew.status).toBe(201);
  const brodo = await calls.createRecipe({
    type: "batch",
    name: "Brodo (demo)",
    outputQty: 5,
    outputUnit: "l",
    portionsPerBatch: 20,
    shelfLifeHours: 48,
    lines: [
      { ingredientId: ids.onionId, qty: 0.2, unit: "kg" },
      { ingredientId: ids.saltId, qty: 30, unit: "g" },
    ],
  });
  expect(brodo.status).toBe(201);
  return {
    soffrittoKey: sub.body.recipe.key,
    stewKey: stew.body.recipe.key,
    brodoKey: brodo.body.recipe.key,
  };
}

/**
 * Tenant A's batch fixture: Cella, the ingredients (the water is not stock, the salt is never bought), beef lots
 * L-D2 3 kg (D+2) and L-D5 3 kg (D+5) at 10,00 EUR/kg, onion L-CIP 2 kg and carrot L-CAR 2 kg at 1,00, and the three
 * recipes of seedStewRecipe.
 */
export async function seedBatchFixture(
  db: SupabaseClient,
  tenantId: string,
  calls: FixtureCalls,
): Promise<BatchFixture> {
  const supplierId = await seedSupplier(db, tenantId);
  const cellaId = await seedLocation(db, tenantId);
  const made = await db
    .from("ingredient")
    .insert([
      { tenant_id: tenantId, name: "Manzo muscolo (demo)", base_unit: "kg", is_stock: true },
      { tenant_id: tenantId, name: "Cipolla (demo)", base_unit: "kg", is_stock: true },
      { tenant_id: tenantId, name: "Carota (demo)", base_unit: "kg", is_stock: true },
      { tenant_id: tenantId, name: "Sale grosso (demo)", base_unit: "kg", is_stock: true },
      { tenant_id: tenantId, name: "Acqua (demo)", base_unit: "l", is_stock: false },
    ])
    .select("id, name");
  expect(made.error).toBeNull();
  const byName = new Map((made.data ?? []).map((row) => [row.name as string, row.id as string]));
  const ids = {
    beefId: byName.get("Manzo muscolo (demo)")!,
    onionId: byName.get("Cipolla (demo)")!,
    carrotId: byName.get("Carota (demo)")!,
    saltId: byName.get("Sale grosso (demo)")!,
    waterId: byName.get("Acqua (demo)")!,
  };

  const approved = await approveWithLots(
    db,
    tenantId,
    {
      supplierId,
      date: calls.day(-1),
      lines: [
        {
          description: "Manzo L-D2",
          ingredientId: ids.beefId,
          qty: 3,
          unit: "kg",
          unitPrice: 10,
          lotCode: "L-D2",
          expiry: calls.day(2),
        },
        {
          description: "Manzo L-D5",
          ingredientId: ids.beefId,
          qty: 3,
          unit: "kg",
          unitPrice: 10,
          lotCode: "L-D5",
          expiry: calls.day(5),
        },
        {
          description: "Cipolla L-CIP",
          ingredientId: ids.onionId,
          qty: 2,
          unit: "kg",
          unitPrice: 1,
          lotCode: "L-CIP",
          expiry: calls.day(7),
        },
        {
          description: "Carota L-CAR",
          ingredientId: ids.carrotId,
          qty: 2,
          unit: "kg",
          unitPrice: 1,
          lotCode: "L-CAR",
          expiry: calls.day(7),
        },
      ],
    },
    (invoiceId) => calls.approve(invoiceId, cellaId),
  );
  expect(approved.status).toBe(200);

  return { supplierId, cellaId, ...ids, ...(await seedStewRecipe(ids, calls)) };
}

/**
 * M15: the batch recipe "Ragù (demo)": 2 kg out, 10 portions, 48 h, made from 2 kg of beef. With beef at 10,00 EUR/kg
 * one batch costs 20,00 EUR, so 2,00 EUR a portion. Returns the recipe key.
 */
export async function seedRaguRecipe(
  ids: Pick<BatchFixture, "beefId">,
  calls: Pick<FixtureCalls, "createRecipe">,
): Promise<string> {
  const made = await calls.createRecipe({
    type: "batch",
    name: "Ragù (demo)",
    outputQty: 2,
    outputUnit: "kg",
    portionsPerBatch: 10,
    shelfLifeHours: 48,
    lines: [{ ingredientId: ids.beefId, qty: 2, unit: "kg" }],
  });
  expect(made.status).toBe(201);
  return made.body.recipe.key;
}

type Produced = { status: number; body: { batchId: string; lotCode: string; portions: number } };

/** M15: produces one Ragù batch of 10 portions through the production route (`produce` is that call). */
export async function seedRaguBatch(
  beefId: string,
  raguRecipeId: string,
  produce: (body: object) => Promise<Produced>,
): Promise<Produced["body"]> {
  const made = await produce({
    recipeId: raguRecipeId,
    outputQty: 2,
    inputs: [{ ingredientId: beefId, qty: 2, unit: "kg" }],
  });
  expect(made.status).toBe(201);
  expect(made.body.portions).toBe(10);
  return made.body;
}
