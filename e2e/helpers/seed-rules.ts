import { expect, type Page } from "@playwright/test";
import { addDays, venueDate } from "../../src/lib/time/venue-date";
import { admin, seedInvoice, seedLocation, seedSupplier } from "./seed-invoice";

// Fixtures of the rules spec (M16 plan §3.8), fake data only. Master data and recipes go through the signed-in owner's
// own API calls (`page.request`); the stock arrives the production way (a seeded invoice approved through the API);
// the hourly job is run through `alert_rules_run(p_at)` with the LOCAL stack's secret key (test code only, like the
// other seed helpers). Nothing here reads or writes the alert table.

export { afternoonOf, nextMondayAfter } from "../../tests/helpers/rules-clock";

export const BEEF = "Manzo muscolo (demo)";
export const STEW = "Spezzatino (demo)";
export const MACELLERIA = "Macelleria X (demo)";

/** Runs the hourly rules once at the instant `at` (ISO) and answers how it went. */
export async function runRules(at: string): Promise<{ ok: boolean; items: number }> {
  const run = await admin().rpc("alert_rules_run", { p_at: at });
  expect(run.error).toBeNull();
  return run.data as { ok: boolean; items: number };
}

export interface RulesSeed {
  tenantId: string;
  cellaId: string;
  beefId: string;
  invoiceSupplierId: string;
  macelleriaId: string;
  packId: string;
  /** Null unless the stew was asked for. */
  stewKey: string | null;
}

/** Receives `qty` kg of beef into Cella in one lot that expires in 60 days (usable on any clock of the spec). */
export async function receiveBeef(
  page: Page,
  seed: Pick<RulesSeed, "tenantId" | "cellaId" | "beefId" | "invoiceSupplierId">,
  qty: number,
  lotCode: string,
): Promise<void> {
  const today = venueDate(new Date());
  const invoiceId = await seedInvoice(
    admin(),
    seed.tenantId,
    {
      name: `fattura-${lotCode.toLowerCase()}-demo.pdf`,
      supplierId: seed.invoiceSupplierId,
      invoiceDate: addDays(today, -1),
      lines: [
        {
          description: `${BEEF} ${lotCode}`,
          qty,
          unit: "kg",
          unitPrice: 10,
          mappedTo: BEEF,
          lotCode,
          expiry: addDays(today, 60),
        },
      ],
    },
    { [BEEF]: seed.beefId },
  );
  const approved = await page.request.post(`/api/invoices/${invoiceId}/approve`, {
    data: { locationId: seed.cellaId },
  });
  expect(approved.status()).toBe(200);
}

/**
 * For the signed-in owner's tenant: Cella, the beef with `beefKg` kg on hand, "Macelleria X (demo)" with a 5 kg pack of
 * beef (not preferred yet) and, when asked, the stew (6 kg, 30 portions, 72 h, 5 kg of beef) whose version carries
 * minimum 4, target 20 and 120 minutes of prep, so the recipe screen has "dalla ricetta" hints to lose.
 */
export async function seedRulesTenant(
  page: Page,
  tenantId: string,
  options: { beefKg: number; stew: boolean },
): Promise<RulesSeed> {
  const db = admin();
  const invoiceSupplierId = await seedSupplier(db, tenantId, { paymentTermsDays: 30 });
  const cellaId = await seedLocation(db, tenantId, "Cella (demo)");
  const made = await db
    .from("ingredient")
    .insert({ tenant_id: tenantId, name: BEEF, base_unit: "kg" })
    .select("id")
    .single();
  expect(made.error).toBeNull();
  const beefId = made.data!.id as string;

  const supplier = await page.request.post("/api/suppliers", { data: { name: MACELLERIA } });
  expect(supplier.status()).toBe(201);
  const macelleriaId = ((await supplier.json()) as { supplier: { id: string } }).supplier.id;
  const pack = await page.request.post("/api/supplier-items", {
    data: {
      supplierId: macelleriaId,
      ingredientId: beefId,
      supplierCode: "MAN-5KG",
      packQty: 5,
      packUnit: "kg",
    },
  });
  expect(pack.status()).toBe(201);
  const packId = ((await pack.json()) as { item: { id: string } }).item.id;

  const seed = { tenantId, cellaId, beefId, invoiceSupplierId };
  await receiveBeef(page, seed, options.beefKg, "L-RULES");

  let stewKey: string | null = null;
  if (options.stew) {
    const created = await page.request.post("/api/recipes", {
      data: {
        type: "batch",
        name: STEW,
        outputQty: 6,
        outputUnit: "kg",
        portionsPerBatch: 30,
        shelfLifeHours: 72,
        minPortions: 4,
        targetPortions: 20,
        prepTimeMin: 120,
        lines: [{ ingredientId: beefId, qty: 5, unit: "kg" }],
      },
    });
    expect(created.status()).toBe(201);
    stewKey = ((await created.json()) as { recipe: { key: string } }).recipe.key;
  }
  return { ...seed, macelleriaId, packId, stewKey };
}
