import { expect, type Page } from "@playwright/test";
import { addDays, venueDate } from "../../src/lib/time/venue-date";
import { quoteUuid, runSql } from "../../tests/integration/helpers/sql";
import { admin, seedInvoice, seedLocation, seedSupplier } from "./seed-invoice";
import { seedRaguRecipe, seedStewRecipe } from "./seed-recipe";

// Fixtures of the order entry spec (M18 plan §3.8), fake data only. Everything the app can do goes through the signed-in
// owner's own API calls (`page.request`): recipes, the stew batch (the production route), plates and menu items. The
// LOCAL stack's secret key only creates the supplier, the two locations, the beef and the invoice (test code, like
// the other seed helpers); the push columns of one dish are written with SQL on the local database (M23 owns the API).

export const NAMES = {
  stew: "Spezzatino con polenta (demo)",
  tagliatelle: "Tagliatelle al ragù (demo)",
  bruschetta: "Bruschetta (demo)",
  zuppa: "Zuppa del giorno (demo)",
  tiramisu: "Tiramisù (demo)",
  acqua: "Acqua (demo)",
} as const;

export interface OrderCatalogue {
  stew: string;
  tagliatelle: string;
  bruschetta: string;
  zuppa: string;
  tiramisu: string;
  acqua: string;
  /** For the firing and kitchen specs (M19): the ragù batch recipe key, the beef and the location Cella. */
  raguKey: string;
  beefId: string;
  cellaId: string;
}

const BEEF = "Manzo muscolo (demo)";

async function post<T>(page: Page, path: string, data: object, status: number): Promise<T> {
  const reply = await page.request.post(path, { data });
  expect(reply.status(), `${path}: ${await reply.text()}`).toBe(status);
  return (await reply.json()) as T;
}

/**
 * Seeds the plan's menu for the signed-in owner's tenant and returns the menu item ids:
 * - two locations ("Cella (demo)", "Dispensa (demo)": lesson 1) and 6 kg of beef bought the production way;
 * - the stew batch (3 portions made today) and the ragù batch recipe with NO batch, so "Tagliatelle al ragù (demo)"
 *   has no portion left;
 * - two plates that use one portion of each, and six menu items: the two plates and four unmapped dishes;
 * - "Tiramisù (demo)" pushed for the next three hours at 4,50 EUR (its price is 6,00 EUR).
 */
export async function seedOrderCatalogue(page: Page, tenantId: string): Promise<OrderCatalogue> {
  const db = admin();
  const today = venueDate(new Date());
  const supplierId = await seedSupplier(db, tenantId, { paymentTermsDays: 30 });
  const cellaId = await seedLocation(db, tenantId, "Cella (demo)");
  await seedLocation(db, tenantId, "Dispensa (demo)");
  const made = await db
    .from("ingredient")
    .insert({ tenant_id: tenantId, name: BEEF, base_unit: "kg" })
    .select("id")
    .single();
  expect(made.error).toBeNull();
  const beefId = made.data!.id as string;
  const invoiceId = await seedInvoice(
    db,
    tenantId,
    {
      name: "fattura-comanda-demo.pdf",
      supplierId,
      invoiceDate: addDays(today, -1),
      lines: ["L-D2", "L-D5"].map((code, index) => ({
        description: `Manzo muscolo (demo) lotto ${code}`,
        qty: 3,
        unit: "kg" as const,
        unitPrice: 10,
        mappedTo: BEEF,
        lotCode: code,
        expiry: addDays(today, index === 0 ? 2 : 5),
      })),
    },
    { [BEEF]: beefId },
  );
  const approved = await page.request.post(`/api/invoices/${invoiceId}/approve`, {
    data: { locationId: cellaId },
  });
  expect(approved.status()).toBe(200);

  const stewKey = await seedStewRecipe(page, beefId);
  const raguKey = await seedRaguRecipe(page, beefId);

  // 0,6 kg of the 6 kg / 30 portion stew is 3 portions: the plan's "Ne restano 3".
  const proposal = await page.request.get(`/api/batches/proposal?recipeKey=${stewKey}`);
  expect(proposal.status()).toBe(200);
  const stewVersion = ((await proposal.json()) as { recipe: { id: string } }).recipe.id;
  await post(
    page,
    "/api/batches",
    {
      recipeId: stewVersion,
      outputQty: 0.6,
      portions: 3,
      locationId: cellaId,
      inputs: [{ ingredientId: beefId, qty: 0.5, unit: "kg", locationId: cellaId }],
    },
    201,
  );

  const plate = async (name: string, batchKey: string) =>
    (
      await post<{ recipe: { key: string } }>(
        page,
        "/api/recipes",
        {
          type: "plate",
          name: `${name} (piatto)`,
          salePrice: 12,
          targetGpPct: 70,
          lines: [{ recipeKey: batchKey, qty: 1, unit: "porz" }],
        },
        201,
      )
    ).recipe.key;
  const stewPlate = await plate(NAMES.stew, stewKey);
  const raguPlate = await plate(NAMES.tagliatelle, raguKey);

  const item = async (
    name: string,
    category: string,
    course: string,
    recipeKey: string | null,
    price: number,
  ) =>
    (
      await post<{ item: { id: string } }>(
        page,
        "/api/menu/items",
        { name, category, course, recipeKey, price, vatRate: 10 },
        201,
      )
    ).item.id;
  const catalogue: OrderCatalogue = {
    stew: await item(NAMES.stew, "Secondi", "secondi", stewPlate, 14),
    tagliatelle: await item(NAMES.tagliatelle, "Primi", "primi", raguPlate, 11),
    bruschetta: await item(NAMES.bruschetta, "Antipasti", "antipasti", null, 5),
    zuppa: await item(NAMES.zuppa, "Primi", "primi", null, 9),
    tiramisu: await item(NAMES.tiramisu, "Dolci", "dolci", null, 6),
    acqua: await item(NAMES.acqua, "Bevande", "bevande", null, 2),
    raguKey,
    beefId,
    cellaId,
  };
  runSql(
    `update menu_item set push_until = now() + interval '3 hours', push_price = 4.5 where id = ${quoteUuid(catalogue.tiramisu)}`,
  );
  return catalogue;
}
