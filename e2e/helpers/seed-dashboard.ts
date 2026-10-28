import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, type Page } from "@playwright/test";
import { addDays, venueDate } from "../../src/lib/time/venue-date";
import { seedInvoice, seedLocation, seedSupplier, type SeedLine } from "./seed-invoice";

// Seeds the owner's tenant for the dashboard spec (owner dashboard plan §5 step 14), through the real API of the signed-in
// owner and the local stack's secret key for the invoices in review (as the other e2e helpers do). Same shape as the
// integration helper (tests/integration/helpers/dashboard.ts) with smaller numbers. Fake data only.
//
// Purchases (every price is the same per ingredient, so no price-variance alert; VAT 10 %, payment terms 30 days):
//   day -45  Farina 10 kg x 2,00 + Burro 2 kg x 10,00   gross 44,00  due day -15  overdue
//   day -35  Farina 10 kg x 2,00                         gross 22,00  due day -5   overdue
//   day -27  Farina 10 kg x 2,00                         gross 22,00  due day +3   due soon
//   day  -5  Farina 10 kg x 2,00, lot L-DASH expiring tomorrow   gross 22,00  due day +25  outside the window
// Burro: 2 kg on hand, minimum 5 kg. Waste of 1 kg of Farina: 2,00. Fixed costs: 1.000 + 1.500 + 500 = 3.000,00.
// Plates (price 11,00 with VAT = 10,00 without; 0,1 kg of Farina = 0,20 of food cost, GP 98 %):
//   "Tagliatelle (demo)" target 99 % -> below target; "Gnocchi (demo)" target 90 % -> on target;
//   "Ossobuco (demo)" uses an ingredient that was never bought -> incomplete. Food cost of the menu: 0,40 / 20,00 = 2,00 %.

export const SEEDED = {
  plates: { below: "Tagliatelle (demo)", ok: "Gnocchi (demo)", incomplete: "Ossobuco (demo)" },
  belowMin: "Burro (demo)",
  lotCode: "L-DASH",
  texts: {
    overdue: /Scaduti\s+2\s+·\s+66,00\s+€/,
    dueSoon: /In scadenza entro 7 giorni\s+1\s+·\s+22,00\s+€/,
    foodCost: /2,00\s+%/,
    waste: /2,00\s+€/,
    fixed: /3\.000,00\s+€\s+al mese/,
  },
} as const;

export async function seedDashboardTenant(page: Page, db: SupabaseClient, tenantId: string) {
  const today = venueDate(new Date());
  const day = (offset: number) => addDays(today, offset);
  const supplierId = await seedSupplier(db, tenantId, { paymentTermsDays: 30 });
  const locationId = await seedLocation(db, tenantId);
  const ids: Record<string, string> = {};
  for (const name of ["Farina (demo)", "Burro (demo)", "Senza prezzo (demo)"]) {
    const made = await db
      .from("ingredient")
      .insert({ tenant_id: tenantId, name, base_unit: "kg" })
      .select("id")
      .single();
    expect(made.error).toBeNull();
    ids[name] = made.data!.id as string;
  }

  const buy = async (invoiceDate: string, lines: SeedLine[], name: string) => {
    const id = await seedInvoice(db, tenantId, { name, supplierId, lines, invoiceDate }, ids);
    const approved = await page.request.post(`/api/invoices/${id}/approve`, { data: {} });
    expect(approved.status()).toBe(200);
  };
  const farina = (extra: Partial<SeedLine> = {}): SeedLine => ({
    description: "Farina",
    qty: 10,
    unit: "kg",
    unitPrice: 2,
    mappedTo: "Farina (demo)",
    ...extra,
  });
  await buy(
    day(-45),
    [
      farina(),
      { description: "Burro", qty: 2, unit: "kg", unitPrice: 10, mappedTo: "Burro (demo)" },
    ],
    "acquisto-1.pdf",
  );
  await buy(day(-35), [farina()], "acquisto-2.pdf");
  await buy(day(-27), [farina()], "acquisto-3.pdf");
  await buy(day(-5), [farina({ lotCode: SEEDED.lotCode, expiry: day(1) })], "acquisto-4.pdf");

  const minimum = await db
    .from("ingredient")
    .update({ min_level: 5 })
    .eq("id", ids["Burro (demo)"]!)
    .eq("tenant_id", tenantId);
  expect(minimum.error).toBeNull();

  const plate = (name: string, ingredient: string, targetGpPct: number) =>
    page.request.post("/api/recipes", {
      data: {
        type: "plate",
        name,
        salePrice: 11,
        targetGpPct,
        lines: [{ ingredientId: ids[ingredient], qty: 0.1, unit: "kg" }],
      },
    });
  expect((await plate(SEEDED.plates.below, "Farina (demo)", 99)).status()).toBe(201);
  expect((await plate(SEEDED.plates.ok, "Farina (demo)", 90)).status()).toBe(201);
  expect((await plate(SEEDED.plates.incomplete, "Senza prezzo (demo)", 70)).status()).toBe(201);

  const waste = await page.request.post("/api/stock/waste", {
    data: {
      ingredientId: ids["Farina (demo)"],
      qty: 1,
      unit: "kg",
      reason: "spoilage",
      locationId,
    },
  });
  expect(waste.status()).toBe(201);

  const fixed = await page.request.post("/api/fixed-costs", {
    data: { month: today.slice(0, 7), rentEur: 1000, labourEur: 1500, utilitiesEur: 500 },
  });
  expect(fixed.status()).toBe(201);
}
