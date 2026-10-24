import type { SupabaseClient } from "@supabase/supabase-js";
import { expect } from "vitest";
import { createUser, type Stack, type TestTenant, type TestUser } from "./stack";

// Fixtures of the menu and tables suite (M17 plan §3.8), fake data only. The tenant has TWO locations on purpose
// (lesson 1: nothing in M17 may depend on there being one), a second waiter (several waiters on one table) and the
// plate recipe "Spezzatino con polenta (demo)" created through the owner's API, so its key comes from the response.
// The secret key is used for locations and the ingredient only; it never reads `recipe` or `recipe_key` (no grant).

export interface MenuTablesFixture {
  cellaId: string;
  dispensaId: string;
  ingredientId: string;
  /** The plate recipe's key, at a menu-less sale price of 12,00 EUR and a target GP of 70 %. */
  plateKey: string;
  /** "Cameriere Due Demo": a second waiter of the same tenant. */
  waiter2: TestUser;
}

type Made = { status: number; body: { recipe: { key: string } } };
export interface MenuTablesCalls {
  /** POST /api/recipes as the owner. */
  createRecipe: (body: object) => Promise<Made>;
}

export const PLATE = "Spezzatino con polenta (demo)";

/** Two locations, a second waiter and the plate recipe, for one tenant. */
export async function seedMenuTablesTenant(
  stack: Stack,
  tenant: TestTenant,
  calls: MenuTablesCalls,
): Promise<MenuTablesFixture> {
  const db: SupabaseClient = stack.admin;
  const locations = await db
    .from("location")
    .insert([
      { tenant_id: tenant.id, name: "Cella (demo)" },
      { tenant_id: tenant.id, name: "Dispensa (demo)" },
    ])
    .select("id, name");
  expect(locations.error).toBeNull();
  const byName = new Map(
    (locations.data ?? []).map((row) => [row.name as string, row.id as string]),
  );

  const ingredient = await db
    .from("ingredient")
    .insert({ tenant_id: tenant.id, name: "Manzo muscolo (demo)", base_unit: "kg", is_stock: true })
    .select("id")
    .single();
  expect(ingredient.error).toBeNull();
  const ingredientId = ingredient.data!.id as string;

  const plate = await calls.createRecipe({
    type: "plate",
    name: PLATE,
    salePrice: 12,
    targetGpPct: 70,
    lines: [{ ingredientId, qty: 0.2, unit: "kg" }],
  });
  expect(plate.status).toBe(201);

  return {
    cellaId: byName.get("Cella (demo)")!,
    dispensaId: byName.get("Dispensa (demo)")!,
    ingredientId,
    plateKey: plate.body.recipe.key,
    waiter2: await createUser(stack.env, db, tenant.id, "waiter", "Cameriere Due Demo"),
  };
}
