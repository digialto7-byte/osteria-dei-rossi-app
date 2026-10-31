import { expect, type Page } from "@playwright/test";
import { addDays, venueDate } from "../../src/lib/time/venue-date";
import { addDishAs, fireAs, openSessionAs } from "./seed-closing";
import { admin, seedInvoice, seedLocation, seedSupplier } from "./seed-invoice";
import { seedTables } from "./seed-menu-tables";

// Fixtures of the push and forecast spec (M23 plan §5 step 18), fake data only. Everything the app can do goes through the signed-in users' own API
// calls (`page.request`): the owner creates the recipes, the batches and the menu item; a waiter opens a table, adds and sends the dish. The LOCAL
// stack's secret key only creates the supplier, the location, the beef and the invoice (test code, like the other seed helpers). The server clock
// cannot be moved here, so the "Sugo rapido" batches are made with a shelf life of 20 hours: they fall due within a day of now.

export const PUSH_E2E_NAMES = {
  sugo: "Sugo rapido (demo)",
  pasta: "Pasta al sugo (demo)",
} as const;

export interface PushSeed {
  pastaItemId: string;
  sugoKey: string;
  /** The first sugo batch (2 portions), sold out by the seed: it must not be on the list. */
  soldBatchId: string;
  /** The second sugo batch (5 portions): on the list. */
  liveBatchId: string;
  /** Tables left free for the spec (the seed sold on its own table). */
  freeTableIds: string[];
}

const BEEF = "Manzo muscolo (demo)";

async function created<T>(page: Page, path: string, data: object, what: string): Promise<T> {
  const reply = await page.request.post(path, { data });
  expect(reply.status(), `${what}: ${await reply.text()}`).toBe(201);
  return (await reply.json()) as T;
}

/**
 * As the signed-in owner (`owner`) with a waiter page (`waiter`): beef for the production, the 20-hour sugo recipe, a batch of 2 portions sold out
 * through a table (two "Pasta al sugo", sent), then a batch of 5 portions; the plate and its menu item (9,00 €); and two free tables.
 */
export async function seedPush(owner: Page, waiter: Page, tenantId: string): Promise<PushSeed> {
  const db = admin();
  const today = venueDate(new Date());
  const supplierId = await seedSupplier(db, tenantId, { paymentTermsDays: 30 });
  const cellaId = await seedLocation(db, tenantId, "Cella (demo)");
  const beef = await db
    .from("ingredient")
    .insert({ tenant_id: tenantId, name: BEEF, base_unit: "kg" })
    .select("id")
    .single();
  expect(beef.error).toBeNull();
  const beefId = beef.data!.id as string;
  const invoiceId = await seedInvoice(
    db,
    tenantId,
    {
      name: "fattura-spingere-demo.pdf",
      supplierId,
      invoiceDate: addDays(today, -1),
      lines: [
        {
          description: "Manzo muscolo (demo) lotto L-P1",
          qty: 3,
          unit: "kg" as const,
          unitPrice: 10,
          mappedTo: BEEF,
          lotCode: "L-P1",
          expiry: addDays(today, 5),
        },
      ],
    },
    { [BEEF]: beefId },
  );
  const approved = await owner.request.post(`/api/invoices/${invoiceId}/approve`, {
    data: { locationId: cellaId },
  });
  expect(approved.status(), "approve the beef invoice").toBe(200);

  const sugo = await created<{ recipe: { key: string } }>(
    owner,
    "/api/recipes",
    {
      type: "batch",
      name: PUSH_E2E_NAMES.sugo,
      outputQty: 2,
      outputUnit: "kg",
      portionsPerBatch: 10,
      shelfLifeHours: 20,
      lines: [{ ingredientId: beefId, qty: 1, unit: "kg" }],
    },
    "sugo recipe",
  );
  const proposal = await owner.request.get(`/api/batches/proposal?recipeKey=${sugo.recipe.key}`);
  expect(proposal.status()).toBe(200);
  const versionId = ((await proposal.json()) as { recipe: { id: string } }).recipe.id;
  const produce = async (outputQty: number): Promise<string> =>
    (
      await created<{ batchId: string }>(
        owner,
        "/api/batches",
        {
          recipeId: versionId,
          outputQty,
          locationId: cellaId,
          inputs: [{ ingredientId: beefId, qty: outputQty / 2, unit: "kg", locationId: cellaId }],
        },
        "produce a sugo batch",
      )
    ).batchId;

  const soldBatchId = await produce(0.4);
  const plate = await created<{ recipe: { key: string } }>(
    owner,
    "/api/recipes",
    {
      type: "plate",
      name: `${PUSH_E2E_NAMES.pasta} (piatto)`,
      salePrice: 9,
      targetGpPct: 70,
      lines: [{ recipeKey: sugo.recipe.key, qty: 1, unit: "porz" }],
    },
    "pasta plate",
  );
  const item = await created<{ item: { id: string } }>(
    owner,
    "/api/menu/items",
    {
      name: PUSH_E2E_NAMES.pasta,
      category: "Primi",
      course: "primi",
      recipeKey: plate.recipe.key,
      price: 9,
      vatRate: 10,
    },
    "pasta menu item",
  );
  const pastaItemId = item.item.id;

  // The two portions are sold and sent: the first batch is at 0 and leaves the list.
  const tables = await seedTables(owner, ["Tavolo 1 (demo)", "Tavolo 2 (demo)", "Tavolo 3 (demo)"]);
  const sessionId = await openSessionAs(waiter, tables["Tavolo 1 (demo)"]!, 2);
  const lineId = await addDishAs(waiter, sessionId, pastaItemId, { qty: 2 });
  await fireAs(waiter, sessionId, [lineId]);

  const liveBatchId = await produce(1);
  return {
    pastaItemId,
    sugoKey: sugo.recipe.key,
    soldBatchId,
    liveBatchId,
    freeTableIds: [tables["Tavolo 2 (demo)"]!, tables["Tavolo 3 (demo)"]!],
  };
}
