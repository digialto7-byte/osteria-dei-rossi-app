import { expect, type Page } from "@playwright/test";
import { venueDate } from "../../src/lib/time/venue-date";
import {
  closeAs,
  seedAt2Table,
  seedClosingMenu,
  seedSmallTable,
  type ClosingMenu,
} from "./seed-closing";
import { admin, COUNT_INGREDIENT_NAMES, seedCountStock } from "./seed-invoice";
import { seedTables } from "./seed-menu-tables";

// Fixtures of the reports spec (M22 plan §5 step 17), fake data only. The owner (a signed-in page) sets the menu and the tables; a waiter (another
// signed-in page) sells and closes two tables through the API; the owner approves a seeded invoice of 20 ingredients (5 kg at 10,00 EUR/kg each) and
// counts them twice (monthly), the second time with 0,5 kg missing of the first ingredient. Nothing is a recipe, so the variance of that ingredient is
// exactly 0,5 kg = 5,00 EUR (actual 0,5; theoretical 0), and the dishes are all unmapped.

export interface ReportsSeed {
  menu: ClosingMenu;
  /** The business date the two closes landed on, as the app shows it. */
  day: string;
  /** The ingredient whose count is short (the variance row of the Scostamenti view). */
  shortIngredientId: string;
}

async function ok(
  reply: { status(): number; text(): Promise<string> },
  status: number,
  what: string,
) {
  expect(reply.status(), `${what}: ${await reply.text()}`).toBe(status);
}

async function countMonthly(
  owner: Page,
  locationId: string,
  ingredientIds: string[],
  short: string | null,
): Promise<void> {
  const started = await owner.request.post("/api/counts", {
    data: { type: "monthly", locationId },
  });
  await ok(started, 201, "start the count");
  const id = ((await started.json()) as { id: string }).id;
  const lines = ingredientIds.map((ingredientId) => ({
    ingredientId,
    qty: ingredientId === short ? 4.5 : 5,
    unit: "kg",
  }));
  await ok(
    await owner.request.put(`/api/counts/${id}/lines`, { data: { lines } }),
    200,
    "save the count",
  );
  await ok(
    await owner.request.post(`/api/counts/${id}/close`, { data: {} }),
    200,
    "close the count",
  );
}

/**
 * As the signed-in owner (`owner`) with a waiter page (`waiter`): the menu, two tables, the stock and the opening count; then two tables sold and
 * closed, then the closing count. Returns what the spec needs to find the rows.
 */
export async function seedReports(
  owner: Page,
  waiter: Page,
  tenantId: string,
): Promise<ReportsSeed> {
  const menu = await seedClosingMenu(owner);
  const tables = await seedTables(owner, ["Tavolo 1 (demo)", "Tavolo 2 (demo)"]);

  const stock = await seedCountStock(admin(), tenantId, venueDate(new Date()));
  await ok(
    await owner.request.post(`/api/invoices/${stock.invoiceId}/approve`, { data: {} }),
    200,
    "approve the stock invoice",
  );
  const location = await admin()
    .from("location")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("name", "Cella (demo)")
    .single();
  expect(location.error).toBeNull();
  const locationId = location.data!.id as string;

  await countMonthly(owner, locationId, stock.ingredientIds, null);

  const big = await seedAt2Table(waiter, tables["Tavolo 1 (demo)"]!, menu);
  await closeAs(waiter, big.sessionId, {
    receiptType: "scontrino",
    receiptNumber: "0201",
    paymentType: "card",
  });
  const small = await seedSmallTable(waiter, tables["Tavolo 2 (demo)"]!, menu);
  await closeAs(waiter, small, {
    receiptType: "scontrino",
    receiptNumber: "0202",
    paymentType: "cash",
  });

  const shortIngredientId =
    stock.ingredientIds[COUNT_INGREDIENT_NAMES.indexOf("Ingrediente critico 01 (demo)")]!;
  await countMonthly(owner, locationId, stock.ingredientIds, shortIngredientId);

  const list = await owner.request.get("/api/tables");
  await ok(list, 200, "tables");
  const day = ((await list.json()) as { businessDate: string }).businessDate;
  return { menu, day, shortIngredientId };
}
