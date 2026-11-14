import type { SupabaseClient } from "@supabase/supabase-js";
import { expect } from "vitest";
import { seedLocation, seedReviewInvoice, seedSupplier } from "./invoices";
import type { OrderCalls } from "./orders";

// Fixtures of the trace and sell-through suite (P2-2 plan S18), fake data only. The supplier, the location and the two ingredients are created with the
// secret key (as every suite does); the invoice is put in `review` the way the extraction worker leaves it, and everything after that goes through the
// routes: the approval, the batch recipe, the production, the plate recipe, the menu item. The invoice has two stock lines on purpose, one with a lot
// code and one without, so the review reply can count one line "without a lot" before the approval.

export const TRACE_NAMES = {
  supplier: "Fornitore Demo Srl",
  coded: "Pomodoro Demo",
  uncoded: "Farina Demo",
  batchRecipe: "Ragù Demo",
  plate: "Lasagne Demo",
  lotCode: "L-DEMO-0001",
} as const;

export interface TraceMaster {
  supplierId: string;
  cellaId: string;
  codedId: string;
  uncodedId: string;
}

export interface TraceRecipes {
  batchKey: string;
  batchVersionId: string;
  plateKey: string;
  itemId: string;
}

/** The supplier, the location Cella and the two stock ingredients of tenant A. */
export async function seedTraceMaster(db: SupabaseClient, tenantId: string): Promise<TraceMaster> {
  const supplierId = await seedSupplier(db, tenantId);
  const cellaId = await seedLocation(db, tenantId);
  const made = await db
    .from("ingredient")
    .insert([
      { tenant_id: tenantId, name: TRACE_NAMES.coded, base_unit: "kg", is_stock: true },
      { tenant_id: tenantId, name: TRACE_NAMES.uncoded, base_unit: "kg", is_stock: true },
    ])
    .select("id, name");
  expect(made.error).toBeNull();
  const byName = new Map((made.data ?? []).map((row) => [row.name as string, row.id as string]));
  return {
    supplierId,
    cellaId,
    codedId: byName.get(TRACE_NAMES.coded)!,
    uncodedId: byName.get(TRACE_NAMES.uncoded)!,
  };
}

/**
 * The invoice, in `review`: 5 kg of the coded ingredient with lot L-DEMO-0001 (an expiry ten days ahead) and 5 kg of the uncoded one with no lot code.
 * `receivedOn` is the invoice date (a business date derived by the suite).
 */
export async function seedTraceInvoice(
  db: SupabaseClient,
  tenantId: string,
  master: TraceMaster,
  dates: { receivedOn: string; expiry: string },
): Promise<string> {
  return seedReviewInvoice(db, tenantId, {
    supplierId: master.supplierId,
    date: dates.receivedOn,
    lines: [
      {
        description: `${TRACE_NAMES.coded} ${TRACE_NAMES.lotCode}`,
        ingredientId: master.codedId,
        qty: 5,
        unit: "kg",
        unitPrice: 2,
        lotCode: TRACE_NAMES.lotCode,
        expiry: dates.expiry,
      },
      {
        description: TRACE_NAMES.uncoded,
        ingredientId: master.uncodedId,
        qty: 5,
        unit: "kg",
        unitPrice: 1,
      },
    ],
  });
}

/** Produces the whole batch recipe (2 kg, 10 portions) from 1 kg of the coded ingredient at Cella; resolves to the new batch id. */
export async function produceRagu(
  recipes: Pick<TraceRecipes, "batchVersionId">,
  master: Pick<TraceMaster, "cellaId" | "codedId">,
  calls: Pick<OrderCalls, "produce">,
): Promise<string> {
  const made = await calls.produce({
    recipeId: recipes.batchVersionId,
    outputQty: 2,
    locationId: master.cellaId,
    inputs: [{ ingredientId: master.codedId, qty: 1, unit: "kg", locationId: master.cellaId }],
  });
  expect(made.status).toBe(201);
  return made.body.batchId;
}

/** The batch recipe "Ragù Demo" (1 kg of the coded ingredient makes 2 kg, 10 portions), the plate "Lasagne Demo" (one portion of it) and its menu item at 12,00 €. */
export async function seedTraceRecipes(
  master: Pick<TraceMaster, "codedId">,
  calls: Pick<OrderCalls, "createRecipe" | "versionOf" | "createItem">,
): Promise<TraceRecipes> {
  const batch = await calls.createRecipe({
    type: "batch",
    name: TRACE_NAMES.batchRecipe,
    outputQty: 2,
    outputUnit: "kg",
    portionsPerBatch: 10,
    shelfLifeHours: 72,
    lines: [{ ingredientId: master.codedId, qty: 1, unit: "kg" }],
  });
  expect(batch.status).toBe(201);
  const batchKey = batch.body.recipe.key;
  const plate = await calls.createRecipe({
    type: "plate",
    name: `${TRACE_NAMES.plate} (piatto)`,
    salePrice: 12,
    targetGpPct: 70,
    lines: [{ recipeKey: batchKey, qty: 1, unit: "porz" }],
  });
  expect(plate.status).toBe(201);
  const plateKey = plate.body.recipe.key;
  const item = await calls.createItem({
    name: TRACE_NAMES.plate,
    category: "Primi",
    course: "primi",
    recipeKey: plateKey,
    price: 12,
    vatRate: 10,
  });
  expect(item.status).toBe(201);
  return {
    batchKey,
    batchVersionId: await calls.versionOf(batchKey),
    plateKey,
    itemId: item.body.item.id,
  };
}
