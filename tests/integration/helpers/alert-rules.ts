import type { SupabaseClient } from "@supabase/supabase-js";
import { expect } from "vitest";
import { approveWithLots, seedLocation, seedSupplier } from "./invoices";

// Fixtures and clocks of the rules suite (M16 plan §3.8), fake data only. The master data arrives through the owner's
// own API calls (the caller passes them in, this file knows no route) and the stock the production way: an approved
// invoice with a lot. The rule settings are NOT written here: the suite sets them through PATCH /api/rules/*.

export { afternoonOf, dayOtherThan, middayOf, nextMondayAfter } from "../../helpers/rules-clock";

/** The text with the no-break space before a unit turned into a plain one, for readable assertions. */
export const noNbsp = (text: string): string => text.replaceAll(" ", " ");

type Made<T> = Promise<{ status: number; body: T }>;
export interface RulesFixtureCalls {
  /** POST /api/suppliers as the owner. */
  createSupplier: (body: object) => Made<{ supplier: { id: string } }>;
  /** POST /api/supplier-items as the owner. */
  createSupplierItem: (body: object) => Made<{ item: { id: string } }>;
  /** POST /api/invoices/:id/approve as the owner, into the given location; resolves to the HTTP status. */
  approve: (invoiceId: string, locationId: string) => Promise<number>;
  /** The Rome date `offset` days from today, as YYYY-MM-DD. */
  day: (offset: number) => string;
}

export interface RulesFixture {
  beefId: string;
  cellaId: string;
  /** "Macelleria X (demo)" and its single 5 kg pack of beef (not yet preferred). */
  macelleriaId: string;
  packId: string;
}

/**
 * The Macelleria fixture of one tenant: beef, a cold room, "Macelleria X (demo)" with a 5 kg pack of beef, and `onHandKg`
 * kg of beef received in one lot that expires in 60 days (so it is usable on any clock of the suite). No consumption
 * is posted, so the weekday forecast is 0 (AT3 "no history").
 */
export async function seedRulesFixture(
  db: SupabaseClient,
  tenantId: string,
  onHandKg: number,
  calls: RulesFixtureCalls,
): Promise<RulesFixture> {
  const invoiceSupplierId = await seedSupplier(db, tenantId);
  const cellaId = await seedLocation(db, tenantId);
  const made = await db
    .from("ingredient")
    .insert({ tenant_id: tenantId, name: "Manzo muscolo (demo)", base_unit: "kg", is_stock: true })
    .select("id")
    .single();
  expect(made.error).toBeNull();
  const beefId = made.data!.id as string;

  const supplier = await calls.createSupplier({ name: "Macelleria X (demo)" });
  expect(supplier.status).toBe(201);
  const macelleriaId = supplier.body.supplier.id;
  const pack = await calls.createSupplierItem({
    supplierId: macelleriaId,
    ingredientId: beefId,
    supplierCode: "MAN-5KG",
    packQty: 5,
    packUnit: "kg",
  });
  expect(pack.status).toBe(201);

  const approved = await approveWithLots(
    db,
    tenantId,
    {
      supplierId: invoiceSupplierId,
      date: calls.day(-1),
      lines: [
        {
          description: "Manzo L-RULES",
          ingredientId: beefId,
          qty: onHandKg,
          unit: "kg",
          unitPrice: 10,
          lotCode: "L-RULES",
          expiry: calls.day(60),
        },
      ],
    },
    (invoiceId) => calls.approve(invoiceId, cellaId),
  );
  expect(approved.status).toBe(200);
  return { beefId, cellaId, macelleriaId, packId: pack.body.item.id };
}
