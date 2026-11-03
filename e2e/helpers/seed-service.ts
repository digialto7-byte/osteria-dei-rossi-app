import { expect, type Page } from "@playwright/test";
import { addDays, venueDate } from "../../src/lib/time/venue-date";
import { admin, seedInvoice, seedLocation, seedSupplier } from "./seed-invoice";
import { NAMES } from "./seed-order";
import { seedRaguRecipe, seedStewRecipe } from "./seed-recipe";
import { seedTables } from "./seed-menu-tables";

// Fixtures of the service simulation (M25 step 16, plan §5 step 17), fake data only, following the M21 to M24 names: "Cella (demo)", "Manzo muscolo (demo)",
// "Bruschetta (demo)", "Tagliatelle al ragù (demo)", "Spezzatino con polenta (demo)", "Acqua (demo)", "Tavolo 1 (demo)" to "Tavolo 6 (demo)".
// Everything the app can do goes through the signed-in owner's own API calls (`page.request`); the LOCAL stack's secret key only makes the
// location, the supplier, the beef and the two invoices in review (test code, like the other seed helpers). Nothing is approved or produced
// here: the simulation does both on screen. Dates come from the app's own venue date helper, never from a literal.

export const BEEF = "Manzo muscolo (demo)";
export const CELLA = "Cella (demo)";
export const TABLE_NAMES = [1, 2, 3, 4, 5, 6].map((n) => `Tavolo ${n} (demo)`);
/** Kilos on each of the two invoices; the simulation expects `INVOICE_KG * 2` kilos of beef in stock after approving both. */
export const INVOICE_KG = 6;

export interface ServiceFixture {
  cellaId: string;
  beefId: string;
  /** The two invoices in review, oldest lot first. */
  invoiceIds: string[];
  stewKey: string;
  raguKey: string;
  /** Menu item ids by dish. */
  menu: { bruschetta: string; tagliatelle: string; stew: string; acqua: string };
  /** The six tables' ids, in the order of `TABLE_NAMES`. */
  tableIds: string[];
}

async function post<T>(page: Page, path: string, data: object, status: number): Promise<T> {
  const reply = await page.request.post(path, { data });
  expect(reply.status(), `${path}: ${await reply.text()}`).toBe(status);
  return (await reply.json()) as T;
}

/**
 * As the signed-in owner of `tenantId`: the location, 2 x 6 kg of beef on two invoices in review, the stew and ragù batch recipes with
 * their plates, four menu items, a coperto of 2,00 € and six tables. Services are left at M25c's default (Pranzo from 11:00, Cena from 16:00).
 */
export async function seedService(owner: Page, tenantId: string): Promise<ServiceFixture> {
  const db = admin();
  const today = venueDate(new Date());
  const supplierId = await seedSupplier(db, tenantId, { paymentTermsDays: 30 });
  const cellaId = await seedLocation(db, tenantId, CELLA);
  const made = await db
    .from("ingredient")
    .insert({ tenant_id: tenantId, name: BEEF, base_unit: "kg" })
    .select("id")
    .single();
  expect(made.error).toBeNull();
  const beefId = made.data!.id as string;

  const invoiceIds: string[] = [];
  for (const [index, code] of ["L-S1", "L-S2"].entries()) {
    invoiceIds.push(
      await seedInvoice(
        db,
        tenantId,
        {
          name: `fattura-servizio-${index + 1}-demo.pdf`,
          supplierId,
          invoiceDate: addDays(today, -1),
          lines: [
            {
              description: `${BEEF} lotto ${code}`,
              qty: INVOICE_KG,
              unit: "kg",
              unitPrice: 10,
              mappedTo: BEEF,
              lotCode: code,
              expiry: addDays(today, 5 + index),
            },
          ],
        },
        { [BEEF]: beefId },
      ),
    );
  }

  const stewKey = await seedStewRecipe(owner, beefId);
  const raguKey = await seedRaguRecipe(owner, beefId);
  const plate = async (name: string, batchKey: string) =>
    (
      await post<{ recipe: { key: string } }>(
        owner,
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
        owner,
        "/api/menu/items",
        { name, category, course, recipeKey, price, vatRate: 10 },
        201,
      )
    ).item.id;
  const menu = {
    bruschetta: await item(NAMES.bruschetta, "Antipasti", "antipasti", null, 5),
    tagliatelle: await item(NAMES.tagliatelle, "Primi", "primi", raguPlate, 11),
    stew: await item(NAMES.stew, "Secondi", "secondi", stewPlate, 14),
    acqua: await item(NAMES.acqua, "Bevande", "bevande", null, 2),
  };

  const coperto = await owner.request.patch("/api/settings/coperto", {
    data: { copertoAmount: 2, copertoVatRate: 10 },
  });
  expect(coperto.status(), `coperto: ${await coperto.text()}`).toBe(200);

  const tables = await seedTables(owner, TABLE_NAMES);
  return {
    cellaId,
    beefId,
    invoiceIds,
    stewKey,
    raguKey,
    menu,
    tableIds: TABLE_NAMES.map((name) => tables[name]!),
  };
}
