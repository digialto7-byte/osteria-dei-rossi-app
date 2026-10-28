import type { SupabaseClient } from "@supabase/supabase-js";
import { expect } from "vitest";
import { seedReviewInvoice, type ReviewLineSeed } from "./invoices";

// Fixtures of the dashboard suite (owner dashboard plan §5 step 13), fake data only. Ingredients and recipes come from the
// costing fixtures (the M1 and M7 import routes); the purchases are invoices approved through the real approve route, so
// the payables, the lots, the prices and the stock all come from the production chain. Every price is the same per
// ingredient, so no price-variance alert is raised and the expected figures below are plain arithmetic.
//
// Purchases (VAT 10 %, payment terms 30 days, so a payable is due 30 days after the invoice date):
//   P1  day -45  Manzo 20 x 10, Farina di mais 10 x 1,5, Pane 100 x 0,3, Prova 5 x 10, Burro 2 x 10
//                net 315,00, gross 346,50, due day -15  -> overdue
//   P2  day -35  Manzo 20 x 10                net 200,00, gross 220,00, due day -5   -> overdue
//   P3  day -27  Manzo 20 x 10                gross 220,00, due day +3   -> due soon
//   P4  day -5   Manzo 20 x 10, lot L-DASH expiring day +1   gross 220,00, due day +25 -> outside the window
// Expected: overdue 2 / 566,50; due soon 1 / 220,00.
// Stock: Burro has 2 kg and a minimum of 5 kg -> one ingredient below its minimum. Lot L-DASH (Manzo, 20 kg) expires
// tomorrow -> one expiring lot. A waste of 1 kg of Manzo costs 10,00 -> the week's waste is 10,00, all raw, none unpriced.
// Fixed costs of the month: 1.000 + 1.500 + 500 = 3.000,00, no sales yet.

export const EXPECTED = {
  payables: {
    overdue: { count: 2, amountEur: 566.5 },
    dueSoon: { count: 1, amountEur: 220 },
  },
  belowMinNames: ["Burro (demo)"],
  expiringLotCodes: ["L-DASH"],
  waste: { valueEur: 10, rawValueEur: 10, batchValueEur: 0, unvaluedCount: 0, reason: "spoilage" },
  fixedCosts: { monthlyTotalEur: 3000, perPlateEur: null, reason: "no_sales" },
} as const;

export interface DashboardCalls {
  /** POST /api/invoices/:id/approve as the owner, into the given location; resolves to the HTTP status. */
  approve: (invoiceId: string, locationId: string) => Promise<number>;
  /** POST /api/stock/waste as the owner; resolves to the HTTP status. */
  waste: (body: object) => Promise<number>;
  /** POST /api/fixed-costs as the owner; resolves to the HTTP status. */
  enterFixedCosts: (body: object) => Promise<number>;
  /** The Rome date `offset` days from today, as YYYY-MM-DD. */
  day: (offset: number) => string;
}

export interface DashboardSeedInput {
  db: SupabaseClient;
  tenantId: string;
  supplierId: string;
  locationId: string;
  /** Ingredient ids by their (fake) names, read through the owner's API after the import. */
  ingredientIds: ReadonlyMap<string, string>;
}

const seed = (
  input: DashboardSeedInput,
  name: string,
  qty: number,
  unitPrice: number,
  extra: Partial<ReviewLineSeed> = {},
): ReviewLineSeed => ({
  description: name,
  ingredientId: input.ingredientIds.get(name)!,
  qty,
  unit: name === "Pane (demo)" ? "pz" : "kg",
  unitPrice,
  ...extra,
});

/** Purchases, the minimum of Burro, one waste and the month's fixed costs. */
export async function seedDashboard(input: DashboardSeedInput, calls: DashboardCalls) {
  const buy = async (date: string, lines: ReviewLineSeed[]) => {
    const id = await seedReviewInvoice(input.db, input.tenantId, {
      supplierId: input.supplierId,
      date,
      lines,
    });
    expect(await calls.approve(id, input.locationId)).toBe(200);
  };

  await buy(calls.day(-45), [
    seed(input, "Manzo muscolo (demo)", 20, 10),
    seed(input, "Farina di mais (demo)", 10, 1.5),
    seed(input, "Pane (demo)", 100, 0.3),
    seed(input, "Prova (demo)", 5, 10),
    seed(input, "Burro (demo)", 2, 10),
  ]);
  await buy(calls.day(-35), [seed(input, "Manzo muscolo (demo)", 20, 10)]);
  await buy(calls.day(-27), [seed(input, "Manzo muscolo (demo)", 20, 10)]);
  await buy(calls.day(-5), [
    seed(input, "Manzo muscolo (demo)", 20, 10, { lotCode: "L-DASH", expiry: calls.day(1) }),
  ]);

  const minimum = await input.db
    .from("ingredient")
    .update({ min_level: 5 })
    .eq("id", input.ingredientIds.get("Burro (demo)")!)
    .eq("tenant_id", input.tenantId);
  expect(minimum.error).toBeNull();

  expect(
    await calls.waste({
      ingredientId: input.ingredientIds.get("Manzo muscolo (demo)")!,
      qty: 1,
      unit: "kg",
      reason: "spoilage",
      locationId: input.locationId,
    }),
  ).toBe(201);

  expect(
    await calls.enterFixedCosts({
      month: calls.day(0).slice(0, 7),
      rentEur: 1000,
      labourEur: 1500,
      utilitiesEur: 500,
    }),
  ).toBe(201);
}
