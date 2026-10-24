import { expect, type Page } from "@playwright/test";
import { admin } from "./seed-invoice";
import { fakeEmail } from "./session";

// Fixtures of the menu and tables spec (M17 plan §3.8), fake data only. The plate recipe, the tables and the
// coperto go through the signed-in owner's own API calls (`page.request`); only the staff are created with the
// LOCAL stack's secret key (test code only, like createStaff in helpers/session.ts).

export const PLATE = "Spezzatino con polenta (demo)";
export const WATER = "Acqua (demo)";
export const WAITER_A = "Cameriere Demo";
export const WAITER_B = "Cameriere Due Demo";

/** Adds a waiter with their own display name to the tenant and returns the email to sign in with. */
export async function createWaiter(tenantId: string, displayName: string): Promise<string> {
  const db = admin();
  const email = fakeEmail("waiter");
  const created = await db.auth.admin.createUser({ email, email_confirm: true });
  const authId = created.data.user?.id;
  if (created.error || !authId) throw new Error("Fixture failed: waiter user");
  const member = await db
    .from("app_user")
    .insert({ tenant_id: tenantId, auth_id: authId, role: "waiter", display_name: displayName });
  if (member.error) throw new Error(`Fixture failed: waiter membership: ${member.error.message}`);
  return email;
}

/**
 * The plate recipe "Spezzatino con polenta (demo)" (12,00 EUR before the menu, target GP 70 %) made by the
 * signed-in owner through POST /api/recipes. Returns its key, which the menu item maps.
 */
export async function seedPlateRecipe(page: Page, tenantId: string): Promise<string> {
  const ingredient = await admin()
    .from("ingredient")
    .insert({ tenant_id: tenantId, name: "Manzo muscolo (demo)", base_unit: "kg", is_stock: true })
    .select("id")
    .single();
  expect(ingredient.error).toBeNull();
  const created = await page.request.post("/api/recipes", {
    data: {
      type: "plate",
      name: PLATE,
      salePrice: 12,
      targetGpPct: 70,
      lines: [{ ingredientId: ingredient.data!.id, qty: 0.2, unit: "kg" }],
    },
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { recipe: { key: string } }).recipe.key;
}

/** Creates the tables through POST /api/dining-tables as the signed-in owner; returns their ids by name. */
export async function seedTables(page: Page, names: string[]): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const [index, name] of names.entries()) {
    const made = await page.request.post("/api/dining-tables", {
      data: { name, position: index + 1 },
    });
    expect(made.status()).toBe(201);
    ids[name] = ((await made.json()) as { table: { id: string } }).table.id;
  }
  return ids;
}
