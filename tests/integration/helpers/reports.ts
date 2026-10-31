import { expect } from "vitest";
import { venueDate } from "@/lib/time/venue-date";
import { approveWithLots, seedLocation, seedSupplier } from "./invoices";
import type { ClosingCalls } from "./closing";
import type { Stack, TestTenant } from "./stack";
import type { SupabaseClient } from "@supabase/supabase-js";

// Fixtures of the reports suite (M22 plan §5 step 14), fake data only. Everything the app can do goes through the routes: the coperto setting,
// the menu items, the tables, the lines, the closes (the M21 helpers of ./closing), the Ragù batch and the two monthly counts. Stock arrives the
// production way (an approved invoice with a lot). The secret key only creates the supplier, the location and the ingredient.
//
// The numbers (everything at 10 % VAT, coperto 2,00 EUR per cover):
//   stock      20 kg of beef at 12,00 EUR/kg. The stew plate (menu item "Spezzatino con polenta (demo)") has a recipe of 0,2 kg of beef, so one plate
//              costs 2,40 EUR frozen at fire. The Ragù batch recipe (2 kg out, 2 kg of beef) is produced with 2,3 kg: it over-uses its input by 0,3 kg.
//   table 1    3 covers: 2 and 1/2 stew, 1,5 tagliatelle, 1 wine, and a tagliatelle sent and voided. 100,00 EUR with the coperto.
//   table 2    2 covers: 1 stew, 2 water. 24,00 EUR with the coperto.
//   the day    covers 5, tables 2, gross 124,00, plates 8 (stew 3,5; tagliatelle 1,5; wine 1; water 2), food cost 3,5 x 2,40 = 8,40 EUR on the 44,5454 EUR net
//              of the stew lines: 18,86 %.
//   counts     O (monthly) before the sales: beef counted 20. C (monthly) after: beef counted 16,6. The ledger shows 20 - 2,3 (batch) - 0,7 (the stew
//              plates) = 17,0 before C, so C posts -0,4. Actual 3,4 kg, theoretical 2,0 + 0,7 = 2,7 kg, 0,7 kg = 8,40 EUR.

export interface ReportsCalls extends ClosingCalls {
  /** POST /api/recipes as the owner. */
  createRecipe: (body: object) => Promise<{ status: number; body: { recipe: { key: string } } }>;
  /** GET /api/batches/proposal?recipeKey= as the chef: the id of the version in force. */
  recipeVersionId: (key: string) => Promise<string>;
  /** POST /api/invoices/:id/approve as the owner. */
  approve: (invoiceId: string, locationId: string) => Promise<number>;
  /** POST /api/batches as the chef. */
  produce: (body: object) => Promise<{ status: number }>;
  /** POST /api/counts as the chef. */
  startCount: (type: "monthly", locationId: string) => Promise<{ status: number; id: string }>;
  /** PUT /api/counts/:id/lines as the chef. */
  saveLines: (
    id: string,
    lines: { ingredientId: string; qty: number | null; unit: string }[],
  ) => Promise<{ status: number }>;
  /** POST /api/counts/:id/close as the chef. */
  closeCount: (id: string) => Promise<{ status: number }>;
}

export const REPORT_NAMES = {
  stew: "Spezzatino con polenta (demo)",
  tagliatelle: "Tagliatelle al ragù (demo)",
  acqua: "Acqua (demo)",
  vino: "Vino rosso (demo)",
  beef: "Manzo muscolo (demo)",
} as const;

export const REPORT_PRICES = { stew: 14, tagliatelle: 12.5, acqua: 3, vino: 40.25 } as const;

export interface ReportsFixture {
  cellaId: string;
  beefId: string;
  raguVersionId: string;
  items: { stew: string; tagliatelle: string; acqua: string; vino: string };
  /** The opening monthly count (closed before any sale). */
  openingCountId: string;
}

async function createIngredient(db: SupabaseClient, tenantId: string): Promise<string> {
  const made = await db
    .from("ingredient")
    .insert({ tenant_id: tenantId, name: REPORT_NAMES.beef, base_unit: "kg", is_stock: true })
    .select("id")
    .single();
  expect(made.error).toBeNull();
  return made.data!.id as string;
}

/**
 * Tenant A: coperto, 20 kg of beef, the stew plate recipe and the Ragù batch recipe, the four menu items (only the stew has a recipe) and the
 * opening monthly count with the beef counted at 20 kg. No table is opened yet.
 */
export async function seedReportsTenant(
  stack: Stack,
  tenant: TestTenant,
  calls: ReportsCalls,
): Promise<ReportsFixture> {
  expect((await calls.setCoperto({ copertoAmount: 2, copertoVatRate: 10 })).status).toBe(200);
  const supplierId = await seedSupplier(stack.admin, tenant.id);
  const cellaId = await seedLocation(stack.admin, tenant.id);
  const beefId = await createIngredient(stack.admin, tenant.id);

  const stocked = await approveWithLots(
    stack.admin,
    tenant.id,
    {
      supplierId,
      date: venueDate(new Date()),
      lines: [
        {
          description: "Manzo L-REPORT",
          ingredientId: beefId,
          qty: 20,
          unit: "kg",
          unitPrice: 12,
          lotCode: "L-REPORT",
          expiry: null,
        },
      ],
    },
    (invoiceId) => calls.approve(invoiceId, cellaId),
  );
  expect(stocked.status).toBe(200);

  const plate = await calls.createRecipe({
    type: "plate",
    name: "Spezzatino con polenta (piatto)",
    salePrice: REPORT_PRICES.stew,
    targetGpPct: 70,
    lines: [{ ingredientId: beefId, qty: 0.2, unit: "kg" }],
  });
  expect(plate.status).toBe(201);
  const ragu = await calls.createRecipe({
    type: "batch",
    name: "Ragù (demo)",
    outputQty: 2,
    outputUnit: "kg",
    portionsPerBatch: 10,
    shelfLifeHours: 48,
    lines: [{ ingredientId: beefId, qty: 2, unit: "kg" }],
  });
  expect(ragu.status).toBe(201);
  const raguVersionId = await calls.recipeVersionId(ragu.body.recipe.key);

  const item = async (
    name: string,
    category: string,
    course: string,
    price: number,
    key: string | null,
  ) => {
    const made = await calls.createItem({
      name,
      category,
      course,
      recipeKey: key,
      price,
      vatRate: 10,
    });
    expect(made.status).toBe(201);
    return made.body.item.id;
  };
  const items = {
    stew: await item(
      REPORT_NAMES.stew,
      "Secondi",
      "secondi",
      REPORT_PRICES.stew,
      plate.body.recipe.key,
    ),
    tagliatelle: await item(
      REPORT_NAMES.tagliatelle,
      "Primi",
      "primi",
      REPORT_PRICES.tagliatelle,
      null,
    ),
    acqua: await item(REPORT_NAMES.acqua, "Bevande", "bevande", REPORT_PRICES.acqua, null),
    vino: await item(REPORT_NAMES.vino, "Bevande", "bevande", REPORT_PRICES.vino, null),
  };

  const opening = await calls.startCount("monthly", cellaId);
  expect(opening.status).toBe(201);
  expect(
    (await calls.saveLines(opening.id, [{ ingredientId: beefId, qty: 20, unit: "kg" }])).status,
  ).toBe(200);
  expect((await calls.closeCount(opening.id)).status).toBe(200);

  return { cellaId, beefId, raguVersionId, items, openingCountId: opening.id };
}

/** The Ragù batch with 2,3 kg of beef for a 2 kg output: the recipe says 2,0 kg. */
export async function produceOverusedBatch(
  calls: ReportsCalls,
  fixture: ReportsFixture,
): Promise<void> {
  const made = await calls.produce({
    recipeId: fixture.raguVersionId,
    outputQty: 2,
    locationId: fixture.cellaId,
    inputs: [{ ingredientId: fixture.beefId, qty: 2.3, unit: "kg", locationId: fixture.cellaId }],
  });
  expect(made.status).toBe(201);
}

/** The closing monthly count: the beef counted at 16,6 kg where the ledger shows 17,0. */
export async function closeWithLoss(calls: ReportsCalls, fixture: ReportsFixture): Promise<string> {
  const closing = await calls.startCount("monthly", fixture.cellaId);
  expect(closing.status).toBe(201);
  expect(
    (await calls.saveLines(closing.id, [{ ingredientId: fixture.beefId, qty: 16.6, unit: "kg" }]))
      .status,
  ).toBe(200);
  expect((await calls.closeCount(closing.id)).status).toBe(200);
  return closing.id;
}
