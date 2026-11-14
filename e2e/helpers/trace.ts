import { expect, type Page } from "@playwright/test";
import { addDays } from "../../src/lib/time/venue-date";
import { businessDateOf } from "./business-date";
import { addDishAs, fireAs, openSessionAs } from "./seed-closing";
import { admin, seedInvoice, seedLocation, seedSupplier } from "./seed-invoice";
import { seedTables } from "./seed-menu-tables";

// Fixtures of the trace, push sell-through and booked covers specs (P2-2 plan S19), fake data only. Everything the app can do goes through the signed-in
// users' own API calls (`page.request`): the owner approves the invoice, makes the recipes, the batch and the menu item; a waiter opens a table, adds and
// sends the dish. The LOCAL stack's secret key only creates the supplier, the location, the two ingredients and the invoices (test code, like the other
// seed helpers). Every date a business-date default later reads (the receipt, the expiry, the day of the sale) comes from `businessDateOf(owner)`, the
// 02:00 cut-off aware date the screens use, never from the calendar: between 00:00 and 02:00 in Rome the two differ.

export const TRACE_E2E = {
  lotCode: "L-DEMO-0001",
  coded: "Pomodoro Demo",
  uncoded: "Farina Demo",
  batchRecipe: "Ragù Demo",
  plate: "Lasagne Demo",
  tables: ["Tavolo 1 (demo)", "Tavolo 2 (demo)"],
} as const;

export interface TraceE2eSeed {
  /** The business date when the seed started: the specs read it again at the end and compare. */
  day: string;
  supplierId: string;
  codedId: string;
  uncodedId: string;
  batchId: string;
  itemId: string;
  /** The id of the lot with the code L-DEMO-0001, read through the trace search. */
  lotId: string;
  tableIds: string[];
}

async function created<T>(page: Page, path: string, data: object, what: string): Promise<T> {
  const reply = await page.request.post(path, { data });
  expect(reply.status(), `${what}: ${await reply.text()}`).toBe(201);
  return (await reply.json()) as T;
}

/**
 * As the signed-in owner (`owner`): the supplier "Fornitore Demo Srl", the location Cella, the ingredients "Pomodoro Demo" and "Farina Demo" (kg), an invoice
 * of 5 kg of each (the tomato with the lot L-DEMO-0001 and an expiry ten days ahead, the flour with no lot code) dated the day before the business date and
 * approved through the API, the batch recipe "Ragù Demo" (1 kg of tomato makes 2 kg, 10 portions) with `shelfLifeHours`, one batch of it, the plate
 * "Lasagne Demo" (one portion of the ragù, 12,00 €) as a menu item, and two tables.
 */
export async function seedTraceE2e(
  owner: Page,
  tenantId: string,
  shelfLifeHours: number,
): Promise<TraceE2eSeed> {
  const db = admin();
  const day = await businessDateOf(owner);
  const supplierId = await seedSupplier(db, tenantId, { paymentTermsDays: 30 });
  const cellaId = await seedLocation(db, tenantId, "Cella (demo)");
  const made = await db
    .from("ingredient")
    .insert([
      { tenant_id: tenantId, name: TRACE_E2E.coded, base_unit: "kg", is_stock: true },
      { tenant_id: tenantId, name: TRACE_E2E.uncoded, base_unit: "kg", is_stock: true },
    ])
    .select("id, name");
  expect(made.error).toBeNull();
  const byName = new Map((made.data ?? []).map((row) => [row.name as string, row.id as string]));
  const codedId = byName.get(TRACE_E2E.coded)!;
  const uncodedId = byName.get(TRACE_E2E.uncoded)!;

  const invoiceId = await seedInvoice(
    db,
    tenantId,
    {
      name: "fattura-tracciabilita-demo.pdf",
      supplierId,
      invoiceDate: addDays(day, -1),
      lines: [
        {
          description: `${TRACE_E2E.coded} ${TRACE_E2E.lotCode}`,
          qty: 5,
          unit: "kg",
          unitPrice: 2,
          mappedTo: TRACE_E2E.coded,
          lotCode: TRACE_E2E.lotCode,
          expiry: addDays(day, 10),
        },
        {
          description: TRACE_E2E.uncoded,
          qty: 5,
          unit: "kg",
          unitPrice: 1,
          mappedTo: TRACE_E2E.uncoded,
        },
      ],
    },
    { [TRACE_E2E.coded]: codedId, [TRACE_E2E.uncoded]: uncodedId },
  );
  const approved = await owner.request.post(`/api/invoices/${invoiceId}/approve`, {
    data: { locationId: cellaId },
  });
  expect(approved.status(), `approve the invoice: ${await approved.text()}`).toBe(200);

  const recipe = await created<{ recipe: { key: string } }>(
    owner,
    "/api/recipes",
    {
      type: "batch",
      name: TRACE_E2E.batchRecipe,
      outputQty: 2,
      outputUnit: "kg",
      portionsPerBatch: 10,
      shelfLifeHours,
      lines: [{ ingredientId: codedId, qty: 1, unit: "kg" }],
    },
    "batch recipe",
  );
  const proposal = await owner.request.get(`/api/batches/proposal?recipeKey=${recipe.recipe.key}`);
  expect(proposal.status()).toBe(200);
  const versionId = ((await proposal.json()) as { recipe: { id: string } }).recipe.id;
  const batch = await created<{ batchId: string }>(
    owner,
    "/api/batches",
    {
      recipeId: versionId,
      outputQty: 2,
      locationId: cellaId,
      inputs: [{ ingredientId: codedId, qty: 1, unit: "kg", locationId: cellaId }],
    },
    "produce the batch",
  );
  const plate = await created<{ recipe: { key: string } }>(
    owner,
    "/api/recipes",
    {
      type: "plate",
      name: `${TRACE_E2E.plate} (piatto)`,
      salePrice: 12,
      targetGpPct: 70,
      lines: [{ recipeKey: recipe.recipe.key, qty: 1, unit: "porz" }],
    },
    "plate recipe",
  );
  const item = await created<{ item: { id: string } }>(
    owner,
    "/api/menu/items",
    {
      name: TRACE_E2E.plate,
      category: "Primi",
      course: "primi",
      recipeKey: plate.recipe.key,
      price: 12,
      vatRate: 10,
    },
    "menu item",
  );
  const tables = await seedTables(owner, [...TRACE_E2E.tables]);

  const found = await owner.request.get(`/api/trace/lots?q=${TRACE_E2E.lotCode}`);
  expect(found.status()).toBe(200);
  const lots = ((await found.json()) as { lots: { lotId: string }[] }).lots;
  expect(lots).toHaveLength(1);

  return {
    day,
    supplierId,
    codedId,
    uncodedId,
    batchId: batch.batchId,
    itemId: item.item.id,
    lotId: lots[0]!.lotId,
    tableIds: TRACE_E2E.tables.map((name) => tables[name]!),
  };
}

/** As a waiter: opens the table, adds one plate and sends it. Resolves to the line id. */
export async function sellOne(waiter: Page, tableId: string, itemId: string): Promise<string> {
  const sessionId = await openSessionAs(waiter, tableId, 2);
  const lineId = await addDishAs(waiter, sessionId, itemId, { qty: 1 });
  await fireAs(waiter, sessionId, [lineId]);
  return lineId;
}

/**
 * An invoice left in `review` for the owner's screen test: two stock lines (the two ingredients of the seed) and no lot code on either, dated the day before
 * the business date. Returns its id; the review screen is /fatture/<id>/revisione.
 */
export async function seedUncodedInvoice(
  tenantId: string,
  seed: Pick<TraceE2eSeed, "day" | "supplierId" | "codedId" | "uncodedId">,
): Promise<string> {
  return seedInvoice(
    admin(),
    tenantId,
    {
      name: "fattura-senza-lotto-demo.pdf",
      supplierId: seed.supplierId,
      invoiceDate: addDays(seed.day, -1),
      lines: [
        {
          description: "Farina Demo senza lotto",
          qty: 2,
          unit: "kg",
          unitPrice: 1,
          mappedTo: TRACE_E2E.uncoded,
        },
        {
          description: "Pomodoro Demo senza lotto",
          qty: 2,
          unit: "kg",
          unitPrice: 2,
          mappedTo: TRACE_E2E.coded,
        },
      ],
    },
    { [TRACE_E2E.coded]: seed.codedId, [TRACE_E2E.uncoded]: seed.uncodedId },
  );
}
